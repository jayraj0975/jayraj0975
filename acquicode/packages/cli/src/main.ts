#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  analyze,
  buildStatement,
  diffDossiers,
  DirectorySource,
  dossierDigest,
  generateSigningKey,
  GitHubForgeProvider,
  GitRepo,
  GitSource,
  OsvProvider,
  parseDeclarations,
  parseRegisterCsv,
  PublicRegistryProvider,
  renderDossierHtml,
  replayProviders,
  signStatement,
  toCycloneDx,
  verifyEnvelope,
  ANALYZER_VERSION,
  RULES_VERSION,
  type AnalyzeOptions,
  type Declarations,
  type Dossier,
  type DsseEnvelope,
  type RepositoryInput,
} from '@acquicode/engine';

const HELP = `acquicode ${ANALYZER_VERSION} (rules ${RULES_VERSION})

Evidence-graded technical diligence. Runs where your code lives; nothing is uploaded unless you run "push".

Usage:
  acquicode scan [repo-path ...] [options]      Analyse one or more repositories (default: .)
  acquicode verify <dossier.json> [options]      Check a signature and/or reproduce a dossier
  acquicode diff <old.json> <new.json> [--out f] What materially changed between snapshots
  acquicode render <dossier.json> [--out f]      Render a dossier to standalone HTML
  acquicode keygen [--out dir]                   Create an Ed25519 signing key pair
  acquicode push <dossier.json> --server URL --token TOKEN [--envelope f]
                                                 Upload a dossier (no source code) to an AcquiCode workspace

scan options:
  --out <dir>             Output directory (default ./acquicode-out)
  --ref <ref>             Commit to analyse (default HEAD; single repository only)
  --name <name>           Repository name (single repository only)
  --title <title>         Dossier title
  --declarations <file>   Company declarations (YAML); default: acquicode.yml in the repository
  --register <file.csv>   IP register CSV (email,name,agreement,signed_on,entity)
  --trace <file>          Agent Trace export supplied out of band (repeatable; recorded as company-asserted)
  --osv                   Check dependencies against OSV.dev (sends public package names and versions)
  --registry              Look up licenses and release dates on npm and PyPI (sends public package names)
  --github-repo <o/r>     With GITHUB_TOKEN set: read pull request approvals for AI-attributed commits
  --no-history-secrets    Do not scan earlier versions of files for credentials
  --omit-extracts         Leave structured extracts (license ids, URLs, trailer values) out of the evidence
  --as-of <YYYY-MM-DD>    Reference date for time-relative rules (recorded in the dossier)
  --previous <file>       Previous dossier.json: also write diff.json and include changes in the HTML
  --sign-key <file.pem>   Sign the dossier (DSSE / in-toto) with this Ed25519 private key
  --fail-on <level>       Exit with code 2 when readiness is BLOCKED (blocked) or not READY (review)

verify options:
  --envelope <file>       DSSE envelope (dossier.dsse.json)
  --key <file.pem>        Trusted public key (repeatable)
  --reproduce <path>      Re-run the analyzer on these repositories (repeatable, same order as the dossier's subjects)
`;

function fail(msg: string, code = 1): never {
  process.stderr.write(`acquicode: ${msg}\n`);
  process.exit(code);
}

async function readJson<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (err) {
    fail(`cannot read ${path}: ${(err as Error).message}`);
  }
}

async function openSource(path: string, opts: { ref?: string; name?: string }) {
  const abs = resolve(path);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) fail(`${path} is not a directory`);
  if (await GitRepo.isRepository(abs)) return GitSource.open(abs, opts);
  process.stderr.write(`acquicode: ${path} is not a git repository; history-dependent sections will be UNKNOWN\n`);
  return new DirectorySource(opts.name ?? abs.split('/').pop()!, abs);
}

async function scan(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string', default: 'acquicode-out' },
      ref: { type: 'string' },
      name: { type: 'string' },
      title: { type: 'string' },
      declarations: { type: 'string' },
      register: { type: 'string' },
      trace: { type: 'string', multiple: true },
      osv: { type: 'boolean', default: false },
      registry: { type: 'boolean', default: false },
      'github-repo': { type: 'string' },
      'no-history-secrets': { type: 'boolean', default: false },
      'omit-extracts': { type: 'boolean', default: false },
      'as-of': { type: 'string' },
      previous: { type: 'string' },
      'sign-key': { type: 'string' },
      'fail-on': { type: 'string' },
    },
  });
  const paths = positionals.length ? positionals : ['.'];
  if (paths.length > 1 && (values.ref || values.name)) fail('--ref and --name apply to a single repository');

  let declarations: Declarations | null = null;
  if (values.declarations) declarations = parseDeclarations(await readFile(values.declarations, 'utf8'), values.declarations);
  if (values.register) {
    const register = parseRegisterCsv(await readFile(values.register, 'utf8'));
    declarations = declarations ?? parseDeclarations('{}', values.register);
    declarations = { ...declarations, contributors: register };
  }

  const traces = await Promise.all((values.trace ?? []).map(async (t) => ({ name: t, text: await readFile(t, 'utf8') })));
  const inputs: RepositoryInput[] = [];
  for (const p of paths) {
    const source = await openSource(p, { ...(values.ref ? { ref: values.ref } : {}), ...(values.name ? { name: values.name } : {}) });
    const input: RepositoryInput = { source };
    if (traces.length) input.agentTraces = traces;
    if (values['github-repo']) {
      const token = process.env.GITHUB_TOKEN;
      if (!token) fail('--github-repo needs GITHUB_TOKEN in the environment');
      const [owner, repo] = values['github-repo'].split('/');
      if (!owner || !repo) fail('--github-repo must be owner/repo');
      input.forge = new GitHubForgeProvider(owner, repo, token);
    }
    inputs.push(input);
  }

  const options: AnalyzeOptions = {
    scanHistoryForSecrets: !values['no-history-secrets'],
    omitExtracts: values['omit-extracts'],
    declarations,
    enrichment: {
      ...(values.osv ? { vulnerabilities: new OsvProvider() } : {}),
      ...(values.registry ? { registry: new PublicRegistryProvider() } : {}),
    },
  };
  if (values.title) options.title = values.title;
  if (values['as-of']) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values['as-of'])) fail('--as-of must be YYYY-MM-DD');
    options.asOf = `${values['as-of']}T00:00:00Z`;
  }

  const started = Date.now();
  const dossier = await analyze(inputs, options);
  const digest = dossierDigest(dossier);
  const out = resolve(values.out);
  await mkdir(out, { recursive: true });
  const json = JSON.stringify(dossier, null, 2);
  const sbom = JSON.stringify(toCycloneDx(dossier), null, 2);
  await writeFile(join(out, 'dossier.json'), json);
  await writeFile(join(out, 'sbom.cdx.json'), sbom);

  let envelope: DsseEnvelope | null = null;
  if (values['sign-key']) {
    const { createHash } = await import('node:crypto');
    const sha = (s: string) => createHash('sha256').update(s).digest('hex');
    const statement = buildStatement(dossier, {
      level: 'SELF_ATTESTED',
      producer: `acquicode-cli ${ANALYZER_VERSION}`,
      artifacts: [
        { name: 'dossier.json', sha256: sha(json) },
        { name: 'sbom.cdx.json', sha256: sha(sbom) },
      ],
    });
    envelope = signStatement(statement, await readFile(values['sign-key'], 'utf8'));
    await writeFile(join(out, 'dossier.dsse.json'), JSON.stringify(envelope, null, 2));
  }

  let diff = null;
  if (values.previous) {
    const prev = await readJson<Dossier>(values.previous);
    diff = diffDossiers(prev, dossier);
    await writeFile(join(out, 'diff.json'), JSON.stringify(diff, null, 2));
  }
  await writeFile(join(out, 'dossier.html'), renderDossierHtml(dossier, { envelope, diff }));

  const c = dossier.summary.counts;
  process.stdout.write(
    [
      `${dossier.readiness.level}  ${dossier.summary.headline}`,
      `  findings: ${c.blocking} blocking, ${c.material} material, ${c.minor} minor · unknowns: ${dossier.unknowns.filter((u) => u.material).length} material`,
      `  AI evidence (files): ${dossier.aiDevelopment.files.direct_line} line-level, ${dossier.aiDevelopment.files.direct_commit} commit-level, ${dossier.aiDevelopment.files.inference} inference-only, ${dossier.aiDevelopment.files.none} no evidence`,
      `  digest ${digest}`,
      `  wrote ${out}/dossier.{json,html}${envelope ? ', dossier.dsse.json' : ''}, sbom.cdx.json${diff ? ', diff.json' : ''} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      '',
    ].join('\n'),
  );
  const failOn = values['fail-on'];
  if (failOn === 'blocked' && dossier.readiness.level === 'BLOCKED') process.exit(2);
  if (failOn === 'review' && dossier.readiness.level !== 'READY') process.exit(2);
}

async function verify(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { envelope: { type: 'string' }, key: { type: 'string', multiple: true }, reproduce: { type: 'string', multiple: true } },
  });
  const file = positionals[0];
  if (!file) fail('verify needs a dossier.json');
  const dossier = await readJson<Dossier>(file);
  const digest = dossierDigest(dossier);
  let ok = true;
  process.stdout.write(`dossier digest ${digest}\n`);
  if (values.envelope) {
    const env = await readJson<DsseEnvelope>(values.envelope);
    const keys = await Promise.all((values.key ?? []).map((k) => readFile(k, 'utf8')));
    if (!keys.length) fail('--envelope needs at least one --key');
    const r = verifyEnvelope(env, keys, dossier);
    process.stdout.write(`signature: ${r.signatureValid ? `valid (${r.keyid})` : 'INVALID'}\ndossier matches signed digest: ${r.dossierMatches ? 'yes' : 'NO'}\n`);
    if (r.statement) process.stdout.write(`attestation: ${r.statement.predicate.attestation.level} by ${r.statement.predicate.attestation.producer} at ${r.statement.predicate.attestation.producedAt}\n`);
    for (const p of r.problems) process.stdout.write(`  problem: ${p}\n`);
    ok &&= r.signatureValid && r.dossierMatches === true;
  }
  if (values.reproduce?.length) {
    if (values.reproduce.length !== dossier.subjects.length) fail(`dossier covers ${dossier.subjects.length} repositories; pass the same number of --reproduce paths`);
    const inputs: RepositoryInput[] = [];
    for (let i = 0; i < dossier.subjects.length; i++) {
      const subj = dossier.subjects[i]!;
      const source = await openSource(values.reproduce[i]!, { ...(subj.headCommit ? { ref: subj.headCommit } : {}), name: subj.name });
      inputs.push({ source, ...(dossier.enrichment.forge ? { forge: replayProviders(dossier.enrichment).forge! } : {}) });
    }
    const opts: AnalyzeOptions = {
      scanHistoryForSecrets: dossier.options.scanHistoryForSecrets !== false,
      omitExtracts: dossier.options.omitExtracts === true,
      enrichment: replayProviders(dossier.enrichment),
      title: dossier.title,
    };
    if (typeof dossier.options.asOf === 'string') opts.asOf = dossier.options.asOf;
    if (!dossier.declarations.supplied || /acquicode\.yml$/.test(dossier.declarations.source ?? '')) opts.declarations = null;
    else process.stdout.write('note: declarations were supplied out of band; pass the same file with scan to reproduce them\n');
    const again = await analyze(inputs, opts);
    const d2 = dossierDigest(again);
    const same = d2 === digest;
    process.stdout.write(`reproduced digest ${d2}: ${same ? 'MATCHES' : 'DIFFERS'}\n`);
    if (!same) {
      const diff = diffDossiers(dossier, again);
      for (const e of diff.events.slice(0, 20)) process.stdout.write(`  ${e.severity}: ${e.summary}\n`);
    }
    ok &&= same;
  }
  if (!values.envelope && !values.reproduce?.length) process.stdout.write('nothing to verify: pass --envelope/--key and/or --reproduce\n');
  process.exit(ok ? 0 : 1);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'scan':
      return scan(rest);
    case 'verify':
      return verify(rest);
    case 'diff': {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { out: { type: 'string' } } });
      if (positionals.length !== 2) fail('diff needs <old.json> <new.json>');
      const d = diffDossiers(await readJson<Dossier>(positionals[0]!), await readJson<Dossier>(positionals[1]!));
      const text = JSON.stringify(d, null, 2);
      if (values.out) await writeFile(values.out, text);
      else process.stdout.write(`${d.from.readiness} → ${d.to.readiness}; ${d.counts.material} material, ${d.counts.minor} minor, ${d.counts.info} info\n${d.events.map((e) => `  [${e.severity}] ${e.summary}`).join('\n')}\n`);
      return;
    }
    case 'render': {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { out: { type: 'string' }, envelope: { type: 'string' } } });
      if (!positionals[0]) fail('render needs a dossier.json');
      const d = await readJson<Dossier>(positionals[0]);
      const env = values.envelope ? await readJson<DsseEnvelope>(values.envelope) : null;
      const html = renderDossierHtml(d, { envelope: env });
      if (values.out) await writeFile(values.out, html);
      else process.stdout.write(html);
      return;
    }
    case 'keygen': {
      const { values } = parseArgs({ args: rest, options: { out: { type: 'string', default: '.' } } });
      const k = generateSigningKey();
      await mkdir(values.out, { recursive: true });
      await writeFile(join(values.out, 'acquicode-signing.key.pem'), k.privateKey, { mode: 0o600 });
      await writeFile(join(values.out, 'acquicode-signing.pub.pem'), k.publicKey);
      process.stdout.write(`key id ${k.keyid}\nwrote ${values.out}/acquicode-signing.key.pem (keep private) and acquicode-signing.pub.pem\n`);
      return;
    }
    case 'push': {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { server: { type: 'string' }, token: { type: 'string' }, envelope: { type: 'string' } } });
      const token = values.token ?? process.env.ACQUICODE_TOKEN;
      if (!positionals[0] || !values.server || !token) fail('push needs <dossier.json> --server URL and --token (or ACQUICODE_TOKEN)');
      const body = { dossier: await readJson<Dossier>(positionals[0]), envelope: values.envelope ? await readJson<DsseEnvelope>(values.envelope) : null };
      const url = new URL('/api/v1/dossiers', values.server);
      if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') fail('refusing to push over plain HTTP');
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      const text = await res.text();
      if (!res.ok) fail(`server answered ${res.status}: ${text.slice(0, 300)}`);
      process.stdout.write(`${text}\n`);
      return;
    }
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      process.stdout.write(HELP);
      return;
    case '--version':
    case 'version':
      process.stdout.write(`${ANALYZER_VERSION}\n`);
      return;
    default:
      fail(`unknown command "${cmd}". Run "acquicode --help".`);
  }
}

main().catch((err: unknown) => {
  const e = err as Error & { violations?: string[] };
  if (e.violations) fail(`refusing to emit a dossier that violates its own evidence rules:\n  ${e.violations.join('\n  ')}`, 3);
  fail(e.message ?? String(err));
});
