import type { RepoContext } from '../context.js';
import type { Dependency, Inventory } from '../model.js';
import { sortBy } from '../canonical.js';
import { basename, dirname } from '../util/paths.js';
import { binaryKindByName, buildOutputDir, vendoredRoot } from './classify.js';

export function analyzeInventory(ctx: RepoContext): Omit<Inventory, 'manifests' | 'lockfiles' | 'ciSystems' | 'containerFiles' | 'agentConfigFiles'> {
  const { evidence, findings } = ctx;
  const langs = new Map<string, { files: number; lines: number }>();
  const classes: Inventory['classes'] = { source: 0, test: 0, docs: 0, config: 0, manifest: 0, lockfile: 0, generated: 0, vendored: 0, binary: 0, asset: 0, symlink: 0, submodule: 0, other: 0 };
  const vendoredRoots = new Set<string>();
  const binaries: Inventory['binaries'] = [];
  const buildOutputs = new Set<string>();
  for (const f of ctx.files) {
    for (const c of f.classes) classes[c]++;
    if (!f.classes.length) classes.other++;
    if (f.language && !f.classes.includes('vendored') && !f.classes.includes('generated')) {
      const l = langs.get(f.language) ?? { files: 0, lines: 0 };
      l.files++;
      l.lines += f.lines ?? 0;
      langs.set(f.language, l);
    }
    const vr = vendoredRoot(f.path);
    if (vr) vendoredRoots.add(vr);
    if (f.classes.includes('binary')) {
      binaries.push({ path: f.path, size: f.size, kind: binaryKindByName(f.path) ?? 'unknown' });
    }
    const bo = buildOutputDir(f.path);
    if (bo && !vr) buildOutputs.add(bo);
  }

  const executables = binaries.filter((b) => ['executable', 'library', 'bytecode', 'archive'].includes(b.kind) && !vendoredRoot(b.path));
  if (executables.length) {
    findings.add({
      rule: 'REP-008',
      state: 'OBSERVED',
      summary: `${executables.length} executable, library, bytecode or archive file(s) are committed (e.g. ${executables.slice(0, 4).map((b) => b.path).join(', ')}). Their contents and origin cannot be established from the repository.`,
      evidence: executables.slice(0, 40).map((b) =>
        evidence.add({ kind: 'file.binary', detector: 'inventory.binary@1', state: 'OBSERVED', locator: { path: b.path }, extract: b.kind, attributes: { size: b.size, sha256: ctx.fileIndex.get(b.path)?.sha256 ?? null } }),
      ),
      fingerprint: 'binaries',
    });
    ctx.unknowns.add('provenance', `Origin and license of ${executables.length} committed binary file(s)`, 'Binaries cannot be inspected like source code.', 'Provide the source or vendor/license information for each binary, or remove them.');
  }
  if (buildOutputs.size) {
    findings.add({
      rule: 'REP-007',
      state: 'OBSERVED',
      summary: `Build output directories are committed: ${[...buildOutputs].slice(0, 5).join(', ')}. Committed artifacts may not correspond to the committed source.`,
      evidence: [...buildOutputs].slice(0, 10).map((d) => evidence.add({ kind: 'repo.build_output', detector: 'inventory.build_output@1', state: 'OBSERVED', locator: { path: d }, attributes: {} })),
      fingerprint: 'build-outputs',
    });
  }

  const sourceFiles = ctx.files.filter((f) => f.classes.includes('source') && !f.classes.includes('vendored') && !f.classes.includes('generated'));
  const testFiles = ctx.files.filter((f) => f.classes.includes('test') && !f.classes.includes('vendored'));
  if (sourceFiles.length >= 20 && testFiles.length / sourceFiles.length < 0.05) {
    findings.add({
      rule: 'MNT-002',
      state: 'DERIVED',
      summary: `${testFiles.length} test file(s) for ${sourceFiles.length} source files (${Math.round((testFiles.length / sourceFiles.length) * 100)}%).`,
      evidence: [],
      fingerprint: 'tests',
    });
  }
  if (!ctx.files.some((f) => dirname(f.path) === '' && /^readme(\.|$)/i.test(basename(f.path)))) {
    if (sourceFiles.length) findings.add({ rule: 'MNT-003', state: 'OBSERVED', summary: 'There is no README at the repository root.', evidence: [], fingerprint: 'readme' });
  }

  return {
    languages: sortBy(
      [...langs.entries()].map(([language, v]) => ({ language, ...v })),
      (l) => -l.lines,
      (l) => l.language,
    ),
    classes,
    submodules: [],
    vendoredRoots: [...vendoredRoots].sort(),
    generatedFiles: classes.generated,
    binaries: sortBy(binaries, (b) => b.path),
    branches: ctx.history?.branches ?? [],
    tags: ctx.history?.tags ?? [],
  };
}

const AI_SDKS: Record<string, Array<[RegExp, string]>> = {
  npm: [
    [/^openai$/, 'OpenAI'], [/^@anthropic-ai\/sdk$/, 'Anthropic'], [/^@google\/(generative-ai|genai)$/, 'Google Gemini'], [/^@google-cloud\/vertexai$/, 'Google Vertex AI'],
    [/^@mistralai\/mistralai$/, 'Mistral'], [/^cohere-ai$/, 'Cohere'], [/^groq-sdk$/, 'Groq'], [/^@aws-sdk\/client-bedrock-runtime$/, 'AWS Bedrock'],
    [/^@azure\/openai$/, 'Azure OpenAI'], [/^replicate$/, 'Replicate'], [/^together-ai$/, 'Together AI'], [/^@huggingface\/inference$/, 'Hugging Face'],
    [/^ai$|^@ai-sdk\//, 'Vercel AI SDK (multi-provider)'], [/^langchain$|^@langchain\//, 'LangChain (multi-provider)'], [/^llamaindex$/, 'LlamaIndex (multi-provider)'],
  ],
  PyPI: [
    [/^openai$/, 'OpenAI'], [/^anthropic$/, 'Anthropic'], [/^google-(generativeai|genai)$/, 'Google Gemini'], [/^google-cloud-aiplatform$/, 'Google Vertex AI'],
    [/^mistralai$/, 'Mistral'], [/^cohere$/, 'Cohere'], [/^groq$/, 'Groq'], [/^replicate$/, 'Replicate'], [/^together$/, 'Together AI'],
    [/^huggingface-hub$/, 'Hugging Face'], [/^langchain(-.*)?$/, 'LangChain (multi-provider)'], [/^llama-index(-.*)?$/, 'LlamaIndex (multi-provider)'], [/^litellm$/, 'LiteLLM (multi-provider)'],
  ],
};

const AI_HOSTS: Array<[RegExp, string]> = [
  [/api\.openai\.com/, 'OpenAI'], [/api\.anthropic\.com/, 'Anthropic'], [/generativelanguage\.googleapis\.com/, 'Google Gemini'],
  [/api\.mistral\.ai/, 'Mistral'], [/api\.cohere\.(ai|com)/, 'Cohere'], [/api\.groq\.com/, 'Groq'], [/openai\.azure\.com/, 'Azure OpenAI'],
  [/bedrock-runtime\.[a-z0-9-]+\.amazonaws\.com/, 'AWS Bedrock'], [/api\.together\.xyz/, 'Together AI'], [/api-inference\.huggingface\.co/, 'Hugging Face'],
];

const MODEL_ID = /["'`](gpt-(?:4o|4\.1|4|5|3\.5)[\w.-]*|o[134](?:-mini|-pro)?(?:-\d{4}-\d{2}-\d{2})?|claude-(?:opus|sonnet|haiku|3|3-5|3-7|4|instant)[\w.-]*|gemini-[\d.]+-[\w.-]+|mistral-(?:large|medium|small)[\w.-]*|command-r[\w.-]*|llama-?[\d.]+[\w.-]*)["'`]/g;

export function analyzeAiDependency(ctx: RepoContext, deps: Dependency[]): { providers: string[]; modelIds: string[] } {
  const { evidence, findings } = ctx;
  const providers = new Map<string, string[]>();
  const add = (p: string, ev: string) => providers.set(p, [...(providers.get(p) ?? []), ev]);
  for (const d of deps) {
    if (!d.direct || d.scope === 'development') continue;
    for (const [re, provider] of AI_SDKS[d.ecosystem] ?? []) {
      if (re.test(d.name)) add(provider, d.evidence[0] ?? '');
    }
  }
  const models = new Map<string, string>();
  for (const f of ctx.files) {
    if (!f.classes.includes('source') || f.classes.includes('vendored') || f.classes.includes('generated')) continue;
    const text = ctx.text.get(f.path);
    if (!text) continue;
    for (const [re, provider] of AI_HOSTS) {
      const m = re.exec(text);
      if (m) add(provider, evidence.add({ kind: 'code.ai_endpoint', detector: 'ai_dependency.endpoint@1', state: 'OBSERVED', locator: { path: f.path }, extract: m[0], attributes: { provider } }));
    }
    MODEL_ID.lastIndex = 0;
    for (const m of text.matchAll(MODEL_ID)) {
      if (models.size > 200) break;
      if (!models.has(m[1]!)) models.set(m[1]!, evidence.add({ kind: 'code.model_id', detector: 'ai_dependency.model_id@1', state: 'OBSERVED', locator: { path: f.path }, extract: m[1]!, attributes: {} }));
    }
  }
  const names = [...providers.keys()].sort();
  if (names.length) {
    const concrete = names.filter((n) => !n.includes('multi-provider'));
    findings.add({
      rule: 'AID-001',
      state: 'OBSERVED',
      materiality: concrete.length === 1 ? 'material' : 'minor',
      summary: `The product calls external AI services: ${names.join(', ')}.${concrete.length === 1 ? ` All direct provider usage found is with ${concrete[0]}; its pricing, terms and model deprecations flow straight into the product.` : ''}`,
      evidence: [...new Set(names.flatMap((n) => providers.get(n) ?? []).filter(Boolean))].slice(0, 40),
      fingerprint: `providers:${names.join('|')}`,
    });
  }
  if (models.size) {
    findings.add({
      rule: 'AID-002',
      state: 'OBSERVED',
      summary: `${models.size} model identifier(s) are hard-coded (${[...models.keys()].sort().slice(0, 6).join(', ')}). Providers retire model versions on their own schedule.`,
      evidence: [...models.values()].slice(0, 40),
      fingerprint: 'model-ids',
    });
  }
  return { providers: names, modelIds: [...models.keys()].sort() };
}
