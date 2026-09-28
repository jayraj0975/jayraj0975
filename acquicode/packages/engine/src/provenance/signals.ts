/**
 * Commit-level AI signals. These are statements a tool (or a person) wrote into
 * commit metadata. They are OBSERVED as statements and are self-declared: a
 * trailer proves the message says so, not that the tool wrote the lines.
 */

export interface CommitSignal {
  tool: string;
  vendor: string | null;
  model: string | null;
  kind: 'trailer' | 'body_marker' | 'subject_prefix' | 'bot_author' | 'bot_committer' | 'name_suffix';
  value: string;
  /**
   * direct: written by the tool that made the change, or by a person, about this commit.
   * editor_inserted: added by an editor from its own telemetry, with known false positives;
   * corroborates tool presence, never establishes AI authorship of the change.
   */
  reliability: 'direct' | 'editor_inserted';
  caveat?: string;
}

/**
 * VS Code's git.addAICoAuthor setting appends this exact trailer. VS Code 1.117
 * (rollout from 2026-04-22) made it the default and, through a bug, added it to
 * commits with no AI involvement, even with AI features disabled; 1.119
 * reverted the default. In its intended "all" mode a single next-edit
 * suggestion is enough to trigger it. microsoft/vscode#313064, #314311.
 */
export const EDITOR_TRAILER_CAVEAT =
  'Inserted by the VS Code editor (git.addAICoAuthor), not by an agent that made the change. VS Code 1.117 added it to commits with no AI involvement (microsoft/vscode#313064), and its "all" mode triggers on a single suggested word.';

function isEditorCopilotTrailer(name: string, email: string): boolean {
  return name.trim().toLowerCase() === 'copilot' && email.trim().toLowerCase() === 'copilot@github.com';
}

interface Identity {
  tool: string;
  vendor: string | null;
  name?: RegExp;
  email?: RegExp;
}

/** Known AI agent identities as they appear in author/committer/co-author fields. */
const AI_IDENTITIES: Identity[] = [
  { tool: 'claude-code', vendor: 'anthropic', email: /(^|[+.])noreply@anthropic\.com$/i },
  { tool: 'claude-code', vendor: 'anthropic', email: /^\d+\+claude(\[bot\])?@users\.noreply\.github\.com$/i },
  { tool: 'claude-code', vendor: 'anthropic', name: /^claude(\[bot\])?$/i, email: /users\.noreply\.github\.com$/i },
  { tool: 'github-copilot', vendor: 'github', email: /^\d+\+copilot(-swe-agent\[bot\])?@users\.noreply\.github\.com$/i },
  { tool: 'github-copilot', vendor: 'github', name: /^copilot(-swe-agent\[bot\])?$/i },
  { tool: 'cursor', vendor: 'anysphere', email: /@cursor\.(com|sh)$/i },
  { tool: 'cursor', vendor: 'anysphere', name: /^cursor( agent)?(\[bot\])?$/i },
  { tool: 'aider', vendor: null, email: /@aider\.chat$/i },
  { tool: 'devin', vendor: 'cognition', email: /devin-ai-integration\[bot\]@users\.noreply\.github\.com$/i },
  { tool: 'devin', vendor: 'cognition', name: /^devin(-ai-integration)?(\[bot\])?$/i },
  { tool: 'jules', vendor: 'google', email: /google-labs-jules\[bot\]@users\.noreply\.github\.com$/i },
  { tool: 'openai-codex', vendor: 'openai', email: /(noreply@openai\.com|codex@openai\.com|chatgpt-codex-connector\[bot\]@users\.noreply\.github\.com)$/i },
  { tool: 'openai-codex', vendor: 'openai', name: /^(openai )?codex(\[bot\])?$/i },
  { tool: 'amazon-q', vendor: 'amazon', email: /amazon-q-developer\[bot\]@users\.noreply\.github\.com$/i },
  { tool: 'windsurf', vendor: 'cognition', email: /@(windsurf|codeium)\.com$/i },
  { tool: 'gemini-cli', vendor: 'google', name: /^gemini( cli| code assist)?(\[bot\])?$/i },
  { tool: 'sweep', vendor: 'sweep', email: /sweep-ai\[bot\]@users\.noreply\.github\.com$/i },
  { tool: 'opencode', vendor: 'sst', email: /@opencode\.ai$/i },
];

/** Non-AI automation. Commits by these are automated but not AI-written. */
const AUTOMATION_BOTS = [/dependabot/i, /renovate/i, /github-actions/i, /greenkeeper/i, /snyk-bot/i, /pre-commit-ci/i, /mergify/i, /semantic-release/i, /\[bot\]/i];

export function matchAiIdentity(name: string, email: string): { tool: string; vendor: string | null } | null {
  for (const id of AI_IDENTITIES) {
    const nameOk = id.name ? id.name.test(name.trim()) : true;
    const emailOk = id.email ? id.email.test(email.trim()) : true;
    if ((id.name || id.email) && nameOk && emailOk) return { tool: id.tool, vendor: id.vendor };
  }
  return null;
}

export function isAutomationBot(name: string, email: string): boolean {
  if (matchAiIdentity(name, email)) return false;
  return AUTOMATION_BOTS.some((re) => re.test(name) || re.test(email));
}

const MODEL_IN_NAME = /\b(claude[\w .-]*?\d[\w.-]*|gpt-[\w.-]+|o\d(?:-[\w]+)?|gemini[\w .-]*?\d[\w.-]*|sonnet[\w .-]*|opus[\w .-]*|haiku[\w .-]*)\b/i;

function modelFrom(text: string): string | null {
  const paren = /\(([^)]+)\)/.exec(text);
  const m = MODEL_IN_NAME.exec(paren ? paren[1]! : text);
  return m ? m[1]!.trim() : null;
}

const ASSIST_TRAILERS = new Set(['assisted-by', 'generated-by', 'ai-assisted', 'ai-tool', 'x-ai-assisted', 'ai-generated', 'co-developed-by']);

const TOOL_WORDS: Array<[RegExp, string, string | null]> = [
  [/claude/i, 'claude-code', 'anthropic'],
  [/copilot/i, 'github-copilot', 'github'],
  [/cursor/i, 'cursor', 'anysphere'],
  [/aider/i, 'aider', null],
  [/devin/i, 'devin', 'cognition'],
  [/codex/i, 'openai-codex', 'openai'],
  [/chatgpt|openai|gpt-?\d/i, 'chatgpt', 'openai'],
  [/gemini|jules/i, 'gemini-cli', 'google'],
  [/windsurf|codeium/i, 'windsurf', 'cognition'],
  [/amazon q|codewhisperer/i, 'amazon-q', 'amazon'],
  [/cline/i, 'cline', null],
];

function toolFromText(text: string): { tool: string; vendor: string | null } | null {
  for (const [re, tool, vendor] of TOOL_WORDS) if (re.test(text)) return { tool, vendor };
  return null;
}

const BODY_MARKERS: Array<[RegExp, string, string | null]> = [
  [/Generated with \[?Claude Code\]?/i, 'claude-code', 'anthropic'],
  [/Generated (?:with|by) \[?Cursor\]?/i, 'cursor', 'anysphere'],
  [/Generated (?:with|by) (?:GitHub )?Copilot/i, 'github-copilot', 'github'],
  [/Generated (?:with|by) \[?(?:OpenAI )?Codex\]?/i, 'openai-codex', 'openai'],
  [/Created by \[?Devin\]?|Devin run: https?:\/\//i, 'devin', 'cognition'],
  [/Generated (?:with|by) \[?Gemini/i, 'gemini-cli', 'google'],
  [/Generated (?:with|by) \[?opencode\]?/i, 'opencode', 'sst'],
];

export function commitSignals(c: {
  subject: string;
  body: string;
  trailers: Array<[string, string]>;
  author: { name: string; email: string };
  committer: { name: string; email: string };
}): CommitSignal[] {
  const out: CommitSignal[] = [];
  for (const [key, value] of c.trailers) {
    const k = key.toLowerCase();
    if (k === 'co-authored-by') {
      const m = /^(.*?)\s*<([^>]*)>\s*$/.exec(value);
      const name = m ? m[1]! : value;
      const email = m ? m[2]! : '';
      const id = matchAiIdentity(name, email);
      if (id) {
        const editor = isEditorCopilotTrailer(name, email);
        out.push({ ...id, model: modelFrom(name), kind: 'trailer', value: `Co-authored-by: ${value}`, reliability: editor ? 'editor_inserted' : 'direct', ...(editor ? { caveat: EDITOR_TRAILER_CAVEAT } : {}) });
      }
    } else if (ASSIST_TRAILERS.has(k)) {
      const id = toolFromText(value) ?? { tool: 'unspecified-ai', vendor: null };
      out.push({ ...id, model: modelFrom(value), kind: 'trailer', value: `${key}: ${value}`, reliability: 'direct' });
    }
  }
  for (const [re, tool, vendor] of BODY_MARKERS) {
    const m = re.exec(c.body);
    if (m && !out.some((s) => s.tool === tool && s.reliability === 'direct')) out.push({ tool, vendor, model: null, kind: 'body_marker', value: m[0], reliability: 'direct' });
  }
  if (/^aider: /i.test(c.subject)) out.push({ tool: 'aider', vendor: null, model: null, kind: 'subject_prefix', value: 'aider:', reliability: 'direct' });
  const authorId = matchAiIdentity(c.author.name, c.author.email);
  if (authorId) out.push({ ...authorId, model: null, kind: 'bot_author', value: `${c.author.name} <${c.author.email}>`, reliability: 'direct' });
  const committerId = matchAiIdentity(c.committer.name, c.committer.email);
  if (committerId && !authorId) out.push({ ...committerId, model: null, kind: 'bot_committer', value: `${c.committer.name} <${c.committer.email}>`, reliability: 'direct' });
  if (/\(aider\)\s*$/i.test(c.author.name) || /\(aider\)\s*$/i.test(c.committer.name)) {
    out.push({ tool: 'aider', vendor: null, model: null, kind: 'name_suffix', value: '(aider)', reliability: 'direct' });
  }
  return out;
}

/** Map tool names used by git-ai / Agent Trace to our tool ids. */
export function normalizeTool(name: string): string {
  const n = name.trim().toLowerCase();
  const map: Record<string, string> = {
    claude: 'claude-code', 'claude-code': 'claude-code', 'claude code': 'claude-code',
    copilot: 'github-copilot', 'github-copilot': 'github-copilot', 'github copilot': 'github-copilot',
    cursor: 'cursor', codex: 'openai-codex', 'openai-codex': 'openai-codex',
    gemini: 'gemini-cli', 'gemini-cli': 'gemini-cli', windsurf: 'windsurf', continue: 'continue',
    aider: 'aider', cline: 'cline', devin: 'devin', jules: 'jules', amp: 'amp', opencode: 'opencode',
    'roo-code': 'roo-code', roo: 'roo-code', junie: 'junie', kiro: 'kiro', 'amazon-q': 'amazon-q',
  };
  return map[n] ?? (n.replace(/[^a-z0-9.-]+/g, '-').slice(0, 40) || 'unspecified-ai');
}

const VENDOR_OF: Record<string, string> = {
  'claude-code': 'anthropic', 'github-copilot': 'github', cursor: 'anysphere', 'openai-codex': 'openai', chatgpt: 'openai',
  'gemini-cli': 'google', jules: 'google', devin: 'cognition', windsurf: 'cognition', 'amazon-q': 'amazon',
  junie: 'jetbrains', kiro: 'amazon', opencode: 'sst', amp: 'sourcegraph',
};

export function vendorOf(tool: string): string | null {
  return VENDOR_OF[tool] ?? null;
}

/** Comments in a file that declare it AI-written (file-level, self-declared). */
const FILE_HEADER_AI = /\b(?:generated|written|created|produced)\s+(?:entirely\s+|mostly\s+|partially\s+)?(?:by|with|using)\s+(?:an?\s+)?(ChatGPT|GPT-?\d[\w.]*|Claude(?: Code)?|GitHub Copilot|Copilot|Gemini|Cursor|Devin|Codex|an? AI(?: assistant| model)?|AI)\b/i;

export function fileHeaderAiMarker(text: string): { marker: string; tool: string } | null {
  const head = text.slice(0, 4096).split('\n').slice(0, 30);
  for (const line of head) {
    if (!/^\s*(\/\/|#|\/\*|\*|<!--|--|;|"""|''')/.test(line)) continue;
    const m = FILE_HEADER_AI.exec(line);
    if (m) {
      const id = toolFromText(m[1]!) ?? { tool: 'unspecified-ai', vendor: null };
      return { marker: m[0], tool: id.tool };
    }
  }
  return null;
}
