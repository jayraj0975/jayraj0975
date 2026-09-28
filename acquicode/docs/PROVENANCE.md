# Provenance: how AcquiCode grades evidence

Core principle: **never confuse inference with evidence.** Every claim in a dossier carries a provenance state, and every piece of AI-origin evidence carries a class. The engine enforces the rules below in code (`packages/engine/src/states.ts`, `invariants.ts`). A dossier that breaks them is never emitted: `checkInvariants` throws, and the scan fails closed.

## 1. Provenance states

Strongest first. Only the first five states *support* a claim.

| State | Meaning | Produced today by |
|---|---|---|
| VERIFIED | Observed and independently checked against a source the subject does not control. | **Reserved.** Analyzer 0.1.0 never emits it. Candidates: signed commits checked against known keys; a dossier reproduced by a second party (the REPRODUCED attestation level). |
| OBSERVED | Read directly from the artifact: a file, a commit, a note, a lockfile entry, a forge API response. | Most facts. |
| DERIVED | Computed deterministically from observed facts. | Question answers built from several facts; direct-push review findings. |
| USER_ASSERTED | Stated by the company, not checked. | Declarations (`acquicode.yml`), the IP register, agent traces supplied outside the repository, traces committed more than 30 days after the revision they describe. |
| INFERRED | A heuristic signal. A reason to ask, never evidence. | Bulk unattributed commits after AI tools appeared (AI-006); tool use implied only by an editor-inserted trailer (AI-013); name-based identity merges; a secret-looking value that is not in a known provider format. |
| UNKNOWN | No evidence either way. | A file with no AI signal; licenses with no metadata; everything history-dependent in a ZIP upload. |
| CONFLICTING | Sources disagree. | A human record and an AI record for the same lines; a declaration contradicted by evidence. |
| UNVERIFIABLE | A claim exists but cannot be checked against the repository. | A trace that names a commit that doesn't exist, a missing file, or out-of-range lines. |
| STALE | Evidence that predates later changes to what it describes. | An origin declaration older than the last change to the files it covers (EVQ-002). |

### Combination rules

- **Conjunction** (`combineAll`, every input must hold): the result is the weakest input, and a derivation from several facts is at most DERIVED. Among non-supporting states, CONFLICTING outranks UNVERIFIABLE, which outranks STALE, which outranks UNKNOWN, so a reader sees a contradiction before a gap.
- **Disjunction** (`combineAny`, any input suffices): the strongest supporting input. Agreement between two sources **cannot** manufacture a stronger state.
- **Capping** (`capAt`): anything learned from the company is at most USER_ASSERTED, whatever format it arrived in.
- **Absence** is UNKNOWN. It is never a negative claim. "No evidence of AI" is not "written by people".

### Hard rules (invariants checked before emission)

| Id | Rule |
|---|---|
| I1 | A BLOCKING finding rests only on OBSERVED or VERIFIED evidence. Weaker findings are downgraded to material, never shown as blockers. |
| I2 | Every cited evidence id exists. |
| I3 | A SATISFIED question never rests on a non-supporting state. |
| I4 | READY requires every question satisfied or not applicable, and no material unknowns. |
| I5 | BLOCKED if and only if there is an active blocking finding. |
| I6 | Per-file AI states match their category: no evidence means UNKNOWN; inference only means INFERRED; direct categories are never INFERRED or UNKNOWN. |
| I7 | AI file counts add up to the files considered. |
| I8 | No provider-format secret appears anywhere in the dossier's text. |
| I9 | Line-level AI counts appear only when line-level records exist. |
| I10 | INFERENCE-class evidence has state INFERRED. |
| I11 | A file counted as directly attributed cites at least one DIRECT evidence item. |
| I12 | Editor-inserted signals are never DIRECT. |

## 2. AI-origin evidence classes

| Class | What it says | Sources |
|---|---|---|
| DIRECT | This change, or these lines, came from a named AI tool, recorded by the tool or the person at the time. | git-ai notes (`refs/notes/ai`, `authorship/3.x`); Agent Trace records; `Co-authored-by` / `Assisted-by` / `Generated-by` trailers written by agents (Claude Code, Cursor Agent, aider, Devin, the Copilot coding agent); agent bot authors; "Generated with …" body markers; `aider:` subject prefixes. |
| CORROBORATING | Supports that a tool was present, not that it wrote a given change. | Agent configuration files (`CLAUDE.md`, `.cursor/rules`, `AGENTS.md`, …); comments in a file saying it was AI-written; **editor-inserted trailers** (below). |
| INFERENCE | A pattern worth asking about. | Large unattributed commits after AI tools were adopted. |

The per-file categories in the dossier follow directly: `direct_line`, `direct_commit`, `corroborating`, `inference`, `none`. A file's category is the strongest class of evidence it has. `none` is shown as "no evidence either way", never as human-written.

### Line-level records are checked, not trusted

git-ai notes and Agent Trace records are matched against the repository:

- A record naming a revision that isn't in history, a file that doesn't exist, or lines beyond the file's length is **UNVERIFIABLE** (AI-004) and carries no weight.
- Two records disagreeing about the same lines (one says AI, another says human) make the file **CONFLICTING** (AI-003).
- Traces supplied outside the repository (`--trace`, uploads) are **USER_ASSERTED**.
- Traces committed more than 30 days after the revision they describe are treated as retroactive, and also **USER_ASSERTED**.

Surviving lines are attributed with `git blame`, following renames, so "AI wrote it, a person renamed it" stays attributed.

### Editor-inserted trailers (second research loop)

VS Code's `git.addAICoAuthor` setting appends `Co-authored-by: Copilot <copilot@github.com>`. VS Code 1.117 (rolled out from 22 April 2026) made it the default and, through a bug, added it to commits with **no AI involvement**, even with AI features disabled. 1.118 changed the default and 1.119 turned it off. Even in its intended `all` mode, a single next-edit suggestion triggers it. Sources: [microsoft/vscode#314311](https://github.com/microsoft/vscode/issues/314311), #313064.

So AcquiCode treats this exact trailer as **CORROBORATING**, with the tool use it implies **INFERRED**:

- Files touched only by such commits are `corroborating`, never `direct_commit`.
- The trailer alone can never make a "no AI" declaration CONFLICTING.
- Rule AI-013 turns it into a question for management: was Copilot enabled, and under which setting?

The Copilot *coding agent's* own identity (`198982749+Copilot@users.noreply.github.com`) remains DIRECT, because the agent made the commit.

## 3. What AcquiCode never claims

- **A percentage of code "written by AI"** from detection. Classifiers are unreliable, and a wrong number in a transaction document is a liability. We report counts of evidence by class.
- **That code is human-written** because nothing says otherwise.
- **That a license is compatible, or that an obligation is triggered.** We report license facts and the declared distribution model, then generate questions for counsel.
- **That software is secure.** We report specific exposures found by specific rules, with their coverage.
- **That a readiness level is a verdict on the software.** Every level travels with the scope statement: it measures how completely the evidence answers the diligence questions.

## 4. Reproducibility is part of provenance

The dossier is deterministic:

- canonical JSON, a SHA-256 digest, and content-addressed ids for evidence, findings and unknowns;
- relative dates computed from the head commit or an explicit `--as-of` that is recorded in the options;
- enrichment responses recorded in the dossier and replayable.

Anyone with access to the same commits can run `acquicode verify --reproduce` and must get a byte-identical digest. That is what lets a buyer trust a seller-run dossier without receiving the code, and it is why there is no language model in the pipeline.
