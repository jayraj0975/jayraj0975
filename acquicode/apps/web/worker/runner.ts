/**
 * Runs one analysis in a separate process so a pathological repository can
 * only exhaust this process (memory cap, wall-clock timeout set by the parent).
 * Input arrives on stdin (so credentials never appear in argv or the
 * environment); the dossier is written to the output path given in the input.
 */
import { writeFile } from 'node:fs/promises';
import {
  analyze,
  DirectorySource,
  GitHubForgeProvider,
  GitSource,
  OsvProvider,
  parseDeclarations,
  PublicRegistryProvider,
  type AnalyzeOptions,
  type RepositoryInput,
} from '@acquicode/engine';

export interface RunnerInput {
  kind: 'git' | 'directory';
  path: string;
  name: string;
  ref: string | null;
  title: string;
  asOf: string;
  enrichment: boolean;
  declarationsYaml: string | null;
  declarationsSource: string;
  forge: { owner: string; repo: string; token: string } | null;
  output: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const input = JSON.parse(await readStdin()) as RunnerInput;
  const source = input.kind === 'git' ? await GitSource.open(input.path, { name: input.name, ...(input.ref ? { ref: input.ref } : {}) }) : new DirectorySource(input.name, input.path);
  const repo: RepositoryInput = { source };
  if (input.forge) repo.forge = new GitHubForgeProvider(input.forge.owner, input.forge.repo, input.forge.token);
  const options: AnalyzeOptions = {
    title: input.title,
    asOf: input.asOf,
    enrichment: input.enrichment ? { vulnerabilities: new OsvProvider(), registry: new PublicRegistryProvider() } : {},
  };
  if (input.declarationsYaml) options.declarations = parseDeclarations(input.declarationsYaml, input.declarationsSource);
  const dossier = await analyze([repo], options);
  await writeFile(input.output, JSON.stringify(dossier), { mode: 0o600 });
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    const e = err as Error & { violations?: string[] };
    process.stderr.write(JSON.stringify({ error: e.message ?? String(err), violations: e.violations ?? null }) + '\n');
    process.exit(1);
  },
);
