import YAML from 'yaml';
import type { RepoContext } from '../context.js';
import { LineIndex } from '../util/text.js';

const UNTRUSTED_CONTEXT = /\$\{\{\s*(github\.event\.(?:issue\.title|issue\.body|pull_request\.title|pull_request\.body|pull_request\.head\.ref|pull_request\.head\.label|comment\.body|review\.body|review_comment\.body|head_commit\.message|head_commit\.author\.(?:email|name)|commits\[\d+\]\.message|pages\[\d+\]\.page_name)|github\.head_ref)\s*\}\}/;
const PIPE_TO_SHELL = /\b(?:curl|wget)\b[^\n|;]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/;
const ECHO_SECRET = /\becho\b[^\n]*\$\{\{\s*secrets\.[A-Za-z0-9_]+\s*\}\}/;

export interface CiResult {
  systems: string[];
  containerFiles: string[];
}

export function analyzeCi(ctx: RepoContext): CiResult {
  const { evidence, findings } = ctx;
  const systems = new Set<string>();
  const containerFiles: string[] = [];
  const unpinned: Array<{ path: string; line: number; uses: string; ev: string }> = [];
  const pipeToShell: Array<{ path: string; ev: string }> = [];
  const writeAll: string[] = [];

  for (const f of ctx.files) {
    const p = f.path;
    if (f.classes.includes('vendored')) continue;
    const text = ctx.text.get(p);
    const isGha = /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p);
    if (isGha) systems.add('github-actions');
    if (p === '.gitlab-ci.yml') systems.add('gitlab-ci');
    if (p === '.circleci/config.yml') systems.add('circleci');
    if (p === 'Jenkinsfile') systems.add('jenkins');
    if (p === 'azure-pipelines.yml') systems.add('azure-pipelines');
    if (p === 'bitbucket-pipelines.yml') systems.add('bitbucket-pipelines');
    if (p === '.travis.yml') systems.add('travis');
    if (/^\.buildkite\//.test(p)) systems.add('buildkite');
    if (text === undefined) continue;
    const lines = new LineIndex(text);

    if (isGha) {
      let doc: Record<string, unknown> | null = null;
      try {
        doc = YAML.parse(text, { maxAliasCount: 50 }) as Record<string, unknown>;
      } catch {
        evidence.add({ kind: 'ci.unparseable', detector: 'ci.github_actions@1', state: 'OBSERVED', locator: { path: p }, attributes: {} });
      }
      const on = doc?.on ?? doc?.['true' as keyof typeof doc];
      const triggers = typeof on === 'string' ? [on] : Array.isArray(on) ? on.map(String) : on && typeof on === 'object' ? Object.keys(on) : [];
      const prTarget = triggers.includes('pull_request_target') || triggers.includes('workflow_run');
      if (prTarget && /github\.event\.pull_request\.head\.(sha|ref)|github\.head_ref|refs\/pull\//.test(text) && /actions\/checkout/.test(text)) {
        const at = text.search(/github\.event\.pull_request\.head\.(sha|ref)|github\.head_ref|refs\/pull\//);
        const ev = evidence.add({ kind: 'ci.pr_target_checkout', detector: 'ci.github_actions@1', state: 'OBSERVED', locator: { path: p, line: lines.lineOf(at) }, extract: 'pull_request_target + checkout of PR head', attributes: {} });
        findings.add({ rule: 'SEC-020', state: 'OBSERVED', summary: `${p} is triggered by ${triggers.includes('pull_request_target') ? 'pull_request_target' : 'workflow_run'} and checks out pull request code, which then runs with repository secrets and a write token.`, evidence: [ev], fingerprint: p });
      }
      for (const m of text.matchAll(new RegExp(UNTRUSTED_CONTEXT.source, 'g'))) {
        // Only interpolation into a shell command (a run: value) is an injection.
        if (!insideRunBlock(text, m.index ?? 0)) continue;
        const ev = evidence.add({ kind: 'ci.script_injection', detector: 'ci.github_actions@1', state: 'OBSERVED', locator: { path: p, line: lines.lineOf(m.index ?? 0) }, extract: m[0], attributes: {} });
        findings.add({ rule: 'SEC-021', state: 'OBSERVED', summary: `${p} interpolates ${m[1]} into a shell command; an attacker who controls that text can run commands in the pipeline.`, evidence: [ev], fingerprint: `${p}:${m[1]}` });
      }
      for (const m of text.matchAll(/^\s*-?\s*uses:\s*["']?([^\s"'#]+)["']?/gm)) {
        const uses = m[1]!;
        if (uses.startsWith('./') || uses.startsWith('docker://')) continue;
        const [, ref = ''] = uses.split('@');
        if (/^[0-9a-f]{40}$/.test(ref)) continue;
        const owner = uses.split('/')[0]!;
        if (owner === 'actions' || owner === 'github') continue; // first-party actions: tag-pinned is common practice
        const line = lines.lineOf(m.index ?? 0);
        unpinned.push({ path: p, line, uses, ev: evidence.add({ kind: 'ci.unpinned_action', detector: 'ci.github_actions@1', state: 'OBSERVED', locator: { path: p, line }, extract: uses, attributes: {} }) });
      }
      if (/^\s*permissions:\s*write-all\s*$/m.test(text)) writeAll.push(p);
      const echo = ECHO_SECRET.exec(text);
      if (echo) {
        const ev = evidence.add({ kind: 'ci.echo_secret', detector: 'ci.github_actions@1', state: 'OBSERVED', locator: { path: p, line: lines.lineOf(echo.index) }, extract: echo[0].slice(0, 120), attributes: {} });
        findings.add({ rule: 'SEC-025', state: 'OBSERVED', summary: `${p} echoes a secret into the job log.`, evidence: [ev], fingerprint: p });
      }
    }

    const isPipeline = isGha || ['.gitlab-ci.yml', '.circleci/config.yml', 'azure-pipelines.yml', 'bitbucket-pipelines.yml', 'Jenkinsfile', '.travis.yml'].includes(p);
    const isDocker = /(^|\/)(Dockerfile(\.[\w.-]+)?|[\w.-]+\.dockerfile|Containerfile)$/i.test(p);
    if (isPipeline || isDocker || /\.(sh|bash)$/.test(p)) {
      const m = PIPE_TO_SHELL.exec(text);
      if (m && (isPipeline || isDocker)) {
        pipeToShell.push({ path: p, ev: evidence.add({ kind: 'ci.pipe_to_shell', detector: 'ci.pipe_to_shell@1', state: 'OBSERVED', locator: { path: p, line: lines.lineOf(m.index) }, extract: m[0].slice(0, 160), attributes: {} }) });
      }
    }

    if (isDocker) {
      containerFiles.push(p);
      const stages = new Set<string>();
      for (const m of text.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/gim)) {
        const image = m[1]!;
        if (m[2]) stages.add(m[2].toLowerCase());
        if (stages.has(image.toLowerCase()) || image === 'scratch' || /^\$\{?[A-Z_]+\}?$/.test(image)) continue;
        if (image.includes('@sha256:')) continue;
        const tag = image.includes(':') ? image.slice(image.lastIndexOf(':') + 1) : '';
        const floating = !tag || tag === 'latest';
        const line = lines.lineOf(m.index ?? 0);
        const ev = evidence.add({ kind: 'container.base_image', detector: 'reproducibility.docker@1', state: 'OBSERVED', locator: { path: p, line }, extract: image, attributes: { floating } });
        findings.add({
          rule: 'REP-004',
          state: 'OBSERVED',
          materiality: floating ? 'material' : 'minor',
          summary: floating ? `${p} builds from ${image}${tag ? '' : ' (no tag, i.e. latest)'}, which changes whenever the publisher pushes.` : `${p} builds from ${image}, pinned by tag but not by digest.`,
          evidence: [ev],
          fingerprint: `${p}:${image}`,
        });
      }
      if (/^\s*ADD\s+https?:\/\//im.test(text)) {
        const m = /^\s*ADD\s+(https?:\/\/\S+)/im.exec(text)!;
        const ev = evidence.add({ kind: 'container.remote_add', detector: 'reproducibility.docker@1', state: 'OBSERVED', locator: { path: p, line: lines.lineOf(m.index) }, extract: m[1]!, attributes: {} });
        findings.add({ rule: 'REP-003', state: 'OBSERVED', summary: `${p} downloads ${m[1]} at build time with ADD, without a checksum.`, evidence: [ev], fingerprint: `${p}:add` });
      }
    }
  }

  if (unpinned.length) {
    const actions = [...new Set(unpinned.map((u) => u.uses))];
    findings.add({
      rule: 'SEC-022',
      state: 'OBSERVED',
      summary: `${actions.length} third-party action reference(s) are pinned to a tag or branch rather than a commit SHA (${actions.slice(0, 5).join(', ')}).`,
      evidence: unpinned.slice(0, 50).map((u) => u.ev),
      fingerprint: 'unpinned-actions',
    });
  }
  if (pipeToShell.length) {
    findings.add({ rule: 'SEC-023', state: 'OBSERVED', summary: `${pipeToShell.length} pipeline or container file(s) pipe a downloaded script into a shell (${pipeToShell.slice(0, 4).map((x) => x.path).join(', ')}).`, evidence: pipeToShell.map((x) => x.ev), fingerprint: 'pipe-to-shell' });
  }
  if (writeAll.length) {
    findings.add({ rule: 'SEC-024', state: 'OBSERVED', summary: `${writeAll.join(', ')} grant${writeAll.length === 1 ? 's' : ''} the workflow token write-all permissions.`, evidence: [], fingerprint: 'write-all' });
  }

  const codeFiles = ctx.files.filter((f) => f.classes.includes('source')).length;
  if (systems.size === 0 && codeFiles > 0) {
    findings.add({ rule: 'REP-005', state: 'OBSERVED', summary: 'No CI configuration was found (GitHub Actions, GitLab CI, CircleCI, Jenkins, Azure Pipelines, Bitbucket, Travis, Buildkite). How the software is built and tested is not recorded in the repository.', evidence: [], fingerprint: 'no-ci' });
    ctx.unknowns.add('reproducibility', 'How the production artifacts are built', 'No CI or build pipeline definition is committed.', 'Commit the build pipeline or provide build documentation and recent build logs.');
  }

  toolchainPins(ctx);
  return { systems: [...systems].sort(), containerFiles: containerFiles.sort() };
}

function toolchainPins(ctx: RepoContext): void {
  const has = (p: string) => ctx.fileIndex.has(p);
  const any = (re: RegExp) => ctx.files.some((f) => re.test(f.path));
  const unpinned: string[] = [];
  const toolVersions = ctx.text.get('.tool-versions') ?? '';
  if (any(/(^|\/)package\.json$/) && !any(/(^|\/)(\.nvmrc|\.node-version)$/) && !/\bnodejs\b/.test(toolVersions)) {
    const pkg = ctx.text.get('package.json');
    if (!pkg || !/"engines"\s*:\s*\{[^}]*"node"/.test(pkg)) unpinned.push('Node.js (no .nvmrc, .node-version or engines.node)');
  }
  if (any(/(^|\/)(pyproject\.toml|requirements[^/]*\.txt|Pipfile)$/) && !any(/(^|\/)\.python-version$/) && !/\bpython\b/.test(toolVersions)) {
    const py = ctx.text.get('pyproject.toml');
    if (!py || !/requires-python|python\s*=/.test(py)) unpinned.push('Python (no .python-version or requires-python)');
  }
  if (any(/(^|\/)Cargo\.toml$/) && !has('rust-toolchain') && !has('rust-toolchain.toml')) {
    const cargo = ctx.text.get('Cargo.toml');
    if (!cargo || !/rust-version/.test(cargo)) unpinned.push('Rust (no rust-toolchain file or rust-version)');
  }
  if (unpinned.length) {
    ctx.findings.add({ rule: 'REP-006', state: 'OBSERVED', summary: `Toolchain versions are not pinned for: ${unpinned.join('; ')}.`, evidence: [], fingerprint: unpinned.map((u) => u.split(' ')[0]).join(',') });
  }
}

/** True when the character at `offset` is part of a `run:` value in a YAML workflow. */
export function insideRunBlock(text: string, offset: number): boolean {
  const lines = text.slice(0, offset).split('\n');
  const current = lines[lines.length - 1]!;
  const sameLine = /^\s*(?:-\s+)?([A-Za-z_-]+):/.exec(current);
  if (sameLine) return sameLine[1] === 'run';
  const indent = (s: string) => s.length - s.trimStart().length;
  const contentIndent = indent(current);
  for (let i = lines.length - 2; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const key = /^(\s*)(?:-\s+)?([A-Za-z_-]+):/.exec(line);
    if (key && indent(line) < contentIndent) return key[2] === 'run';
    if (indent(line) < contentIndent && !key) return false;
  }
  return false;
}
