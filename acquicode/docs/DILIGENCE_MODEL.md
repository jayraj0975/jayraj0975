# Diligence model

A dossier answers **diligence questions**. Findings, unknowns and evidence exist to answer them. This is the structure a buyer's counsel, CTO and deal lead actually read; it is not a scanner's issue list.

Everything below is generated from, or checked against, `packages/engine/src/rules.ts` and `diligence/questions.ts` (rules version `2026.09.1`).

## 1. How to read a dossier

1. **Readiness.** READY, REVIEW or BLOCKED, with the reasons, and always with its scope: it measures how completely the evidence answers the questions, not whether the software is good, secure or free of legal risk.
2. **Why.** The questions, each with a status, a state, a rationale and the findings behind it.
3. **Evidence.** Every finding cites evidence items with locators (commit, path, lines), a provenance state and a class.
4. **Unknown.** Material unknowns are listed on their own, with why each is unknown and what would resolve it.

### Readiness

| Level | Rule |
|---|---|
| BLOCKED | At least one active (not suppressed) finding is BLOCKING. Only OBSERVED or VERIFIED evidence can block (invariant I1); anything weaker is downgraded to material. Today two rules can block:

- **SEC-001.** A credential in a known provider format that is not a placeholder.
- **LIC-010.** Escalated from its base materiality when either:
  - a production dependency has a *known* network-copyleft license and the declared distribution is anything but `internal`; or
  - a production dependency has a *known* strong-copyleft license and the declared distribution is `distributed`, `on_prem`, `mobile`, `library` or `mixed`.

A copyleft block means "counsel must review before this can be READY". It is not a legal conclusion that an obligation is triggered. |
| REVIEW | Not blocked, and any question is ATTENTION or UNKNOWN, or any material unknown remains. |
| READY | Every question SATISFIED or NOT_APPLICABLE and no material unknown. Deliberately hard to reach: it needs history, declarations, an IP register and a vulnerability check. |

### Question statuses

| Status | Meaning |
|---|---|
| SATISFIED | The evidence answers the question favourably, at the stated state (e.g. DERIVED, USER_ASSERTED). |
| ATTENTION | Findings need a response. |
| UNKNOWN | The repository cannot answer it, and why is stated. |
| NOT_APPLICABLE | The question doesn't arise (e.g. no versioned public dependencies to check for vulnerabilities). |

A question's state combines the states of the findings driving its status (`combineAny`). A question can never be more certain than its evidence.

### Materiality and audience

- **Materiality:**
  - `blocking`: stop until resolved.
  - `material`: a buyer will ask; disclose or fix.
  - `minor`: hygiene.
  - `info`: context.
- **Audience:** each finding produces follow-ups for **management**, **counsel** or **engineering**. The dossier groups them into three question lists, so each reader gets their own.
- **Suppressions:** a suppression requires a written reason (at least 10 characters) in the declarations file. It stays visible in the dossier under "Suppressed by the company" and is part of the signed record.

## 2. Questions

| Id | Area | Question | Driven by rules |
|---|---|---|---|
| Q-OWN-1 | ownership | Can the company show who wrote the code and that it holds the rights to it? | OWN-001, OWN-002, OWN-003, OWN-009 |
| Q-OWN-2 | ownership | Does the first-party code contain code owned or licensed by someone else? | OWN-004, OWN-005, OWN-006, OWN-007, OWN-010, OWN-011 |
| Q-PROV-1 | provenance | Can the origin of the code be established from the repository? | OWN-008, REP-008, AI-012 |
| Q-AI-1 | ai_development | What evidence exists of AI involvement in the code, and is it consistent? | AI-001, AI-002, AI-003, AI-004, AI-006, AI-009, AI-011, AI-013 |
| Q-AI-2 | ai_development | Were AI-attributed changes reviewed by a person other than the author? | AI-005 |
| Q-AI-3 | ai_development | Were the AI tools used under terms that protect the company? | AI-008 |
| Q-LIC-1 | licenses | Is the license of the company's own code clear? | LIC-002, LIC-003, LIC-014 |
| Q-LIC-2 | licenses | Are the licenses of production dependencies known? | LIC-013 |
| Q-LIC-3 | licenses | Do production dependencies carry copyleft or use-restricting licenses? | LIC-010, LIC-011, LIC-012 |
| Q-SEC-1 | security | Are credentials exposed in the code or its history? | SEC-001, SEC-002, SEC-003 |
| Q-SEC-2 | security | Are known vulnerabilities in production dependencies understood? | SEC-010, SEC-011 |
| Q-SEC-3 | security | Are the build pipeline and supply chain protected against tampering? | SEC-020, SEC-021, SEC-022, SEC-023, SEC-024, SEC-025, SEC-030, SEC-031, SEC-032, SEC-033, SEC-034 |
| Q-REP-1 | reproducibility | Are the inputs needed to rebuild the software fully declared? | REP-001, REP-002, REP-003, REP-004, REP-005, REP-006, REP-007, REP-008 |
| Q-MNT-1 | maintainability | Can a new owner maintain the software? | MNT-001, MNT-002, MNT-003, MNT-004, MNT-007 |
| Q-AID-1 | ai_dependency | Is the product materially dependent on specific AI providers? | AID-001, AID-002 |
| Q-EVQ-1 | evidence_quality | Which important claims rest on weak, stale or conflicting evidence? | EVQ-002, AI-004, OWN-009, EVQ-003 |

## 3. Rules

The materiality shown is each rule's base level. Some findings are escalated or downgraded by context (e.g. SEC-001 is minor for placeholder values, and material rather than blocking for secret-looking values not in a provider format).

### ai_development

| Rule | Title | Materiality | Audience | Why it matters |
|---|---|---|---|---|
| AI-001 | AI coding tools used in this repository | info | management, counsel | Buyers ask which AI tools were used, on which code, and under which terms. |
| AI-002 | Declaration contradicts recorded AI evidence | material | management, counsel | A disclosure that the evidence contradicts is worse than no disclosure. |
| AI-003 | Attribution sources disagree | material | engineering, management | Two attribution records claim different origins for the same lines. |
| AI-005 | AI-attributed changes without review evidence | material | management, engineering | Acquirers ask what share of AI-written code was reviewed by a human who understood it. |
| AI-006 | Large unattributed changes after AI tools were adopted | minor | management | Inference only: worth asking how these changes were produced. Not evidence of AI origin. |
| AI-008 | AI tool terms not declared | material | counsel | IP indemnities and output terms depend on the plan tier and settings used. |
| AI-011 | Files predominantly attributed to AI with no recorded human authorship | material | counsel | Copyright requires human authorship; counsel should know where records show little or none. |
| AI-013 | Editor-inserted AI co-author trailers (corroborating only) | minor | management, engineering | An editor can add an AI co-author trailer from its own telemetry, including where no AI output was used; it cannot establish which code AI produced. |

### evidence_quality

| Rule | Title | Materiality | Audience | Why it matters |
|---|---|---|---|---|
| AI-004 | Attribution records that cannot be checked | minor | engineering | Records referencing commits or lines that do not exist carry no weight. |
| AI-009 | AI tools configured but attribution not recorded | material | management, engineering | Tool use is indicated but which code it produced was not recorded; origin stays unknown. |
| EVQ-002 | Declarations older than the code they describe | material | management | A declaration made before the code changed no longer speaks to it. |
| EVQ-003 | Uncommitted changes were not analysed | info | engineering | The dossier describes a commit, not the working copy. |
| OWN-009 | Incomplete git history | material | engineering | Ownership and provenance conclusions only cover the history that was available. |

### provenance

| Rule | Title | Materiality | Audience | Why it matters |
|---|---|---|---|---|
| AI-012 | Model weights or binary model artifacts committed | material | counsel, engineering | Model artifacts carry training-data and license provenance that the repository cannot show. |
| OWN-008 | History begins with a bulk import | material | management, counsel | Code that arrived in one commit has no recorded authorship before that point. |

### ai_dependency

| Rule | Title | Materiality | Audience | Why it matters |
|---|---|---|---|---|
| AID-001 | Product depends on external AI providers | material | management, engineering | Pricing, terms or model deprecations at a provider change the product. |
| AID-002 | Hard-coded model identifiers | minor | engineering | Pinned model versions are retired on the provider's schedule. |

### licenses

| Rule | Title | Materiality | Audience | Why it matters |
|---|---|---|---|---|
| LIC-002 | Project license declarations disagree | material | counsel | The license a buyer believes applies must be unambiguous. |
| LIC-003 | Project published under a copyleft license | material | counsel, management | Confirm the licensing intent for the company's own code. |
| LIC-010 | Strong or network copyleft in production dependencies | material | counsel | Copyleft obligations depend on how the software is distributed. |
| LIC-011 | Weak copyleft in production dependencies | minor | counsel | Weak copyleft usually requires notices and keeping modifications open. |
| LIC-012 | Source-available or restrictive licenses in production dependencies | material | counsel | Non-open-source licenses can restrict competing or hosted use. |
| LIC-013 | Production dependencies with unknown licenses | material | counsel, engineering | An unknown license is an unanswered question in the disclosure schedule. |
| LIC-014 | Non-standard license text | material | counsel | Custom or modified license text needs legal reading. |
| OWN-011 | Vendored code without a license file | material | counsel | Third-party code with no license gives no right to use it. |

### maintainability

| Rule | Title | Materiality | Audience | Why it matters |
|---|---|---|---|---|
| MNT-001 | Key-person concentration | material | management | Most recent work depends on one person. |
| MNT-002 | Few or no tests | minor | engineering | Changes cannot be verified automatically. |
| MNT-003 | No README | minor | engineering | New owners have no entry point. |
| MNT-004 | Production dependencies without recent releases | minor | engineering | Unmaintained dependencies stop receiving security fixes. |
| MNT-007 | No recent activity | minor | management, engineering | The repository has not changed in over a year. |

### ownership

| Rule | Title | Materiality | Audience | Why it matters |
|---|---|---|---|---|
| OWN-001 | Contributors without a recorded IP agreement | material | counsel, management | Code written without an assignment may not belong to the company. |
| OWN-002 | Contributions predate the recorded agreement | material | counsel | An agreement signed after the work may not cover earlier contributions unless it assigns prior work. |
| OWN-003 | Contributors using personal or external email identities | material | counsel, management | Buyers ask for IP assignments from every contributor; personal and external identities are the ones most often missing. |
| OWN-004 | Third-party copyright notices in first-party source | material | counsel, engineering | Code carrying another owner's notice was copied in and brings that owner's license terms. |
| OWN-005 | Stack Overflow references in source | material | counsel, engineering | Stack Overflow content is licensed CC BY-SA; copied snippets carry attribution and share-alike terms. |
| OWN-006 | Comments stating code was copied or adapted from a URL | minor | counsel, engineering | Copied code brings the source's license terms. |
| OWN-007 | File-level license identifiers differing from the project | material | counsel | A file under a different license (e.g. GPL) inside a proprietary codebase needs review. |
| OWN-010 | Submodules outside this repository | minor | engineering, counsel | Submodule contents are owned and licensed elsewhere and were not analysed. |

### reproducibility

| Rule | Title | Materiality | Audience | Why it matters |
|---|---|---|---|---|
| REP-001 | Dependencies declared without a lockfile | material | engineering | Without a lockfile the exact dependency set cannot be rebuilt. |
| REP-002 | Manifest and lockfile disagree | material | engineering | Drift means the lockfile does not describe what the manifest asks for. |
| REP-003 | Unpinned dependency sources | minor | engineering | Git branches, URLs and "latest" resolve to different code over time. |
| REP-004 | Container base images not pinned | minor | engineering | Tags move; only digests identify an image. |
| REP-005 | No CI configuration | material | engineering, management | The build process is not recorded anywhere a buyer can inspect. |
| REP-006 | Toolchain versions not pinned | minor | engineering | Unpinned runtimes change build output. |
| REP-007 | Build outputs committed to the repository | minor | engineering | Committed artifacts may not match the source they claim to come from. |
| REP-008 | Executable binaries committed | material | engineering, counsel | Binaries are opaque: their origin, license and contents cannot be established from the repository. |

### security

| Rule | Title | Materiality | Audience | Why it matters |
|---|---|---|---|---|
| SEC-001 | Credentials in the current code | blocking | engineering, management | A live credential in the code is an active exposure. |
| SEC-002 | Credentials in git history | material | engineering | Removed secrets remain retrievable from every clone until rotated. |
| SEC-003 | Environment files committed | material | engineering | Committed .env files usually contain credentials or internal endpoints. |
| SEC-010 | Known high or critical vulnerabilities in production dependencies | material | engineering | Material vulnerabilities must be understood before close. |
| SEC-011 | Dependency flagged as malicious | blocking | engineering, management | A known-malicious package in the dependency tree is an incident, not a finding. |
| SEC-020 | CI workflow runs untrusted pull request code with privileges | material | engineering | pull_request_target with a checkout of the PR head exposes secrets and write tokens. |
| SEC-021 | CI script injection from untrusted input | material | engineering | Attacker-controlled titles or branch names are interpolated into shell commands. |
| SEC-022 | Third-party CI actions not pinned to a commit | minor | engineering | A moved tag changes what runs in the pipeline. |
| SEC-023 | Pipelines pipe remote scripts to a shell | minor | engineering | The build depends on unpinned remote code. |
| SEC-024 | CI token granted write-all permissions | minor | engineering | Broad tokens widen the blast radius of any pipeline compromise. |
| SEC-025 | CI prints secrets | material | engineering | Secrets written to logs are exposed to anyone who can read the logs. |
| SEC-030 | Production dependencies run install scripts | minor | engineering | Install scripts execute arbitrary code at build time. |
| SEC-031 | Dependencies fetched over plain HTTP | material | engineering | Unencrypted downloads can be tampered with in transit. |
| SEC-032 | Lockfile entries without integrity hashes | minor | engineering | Without integrity hashes, a changed package is not detected at install. |
| SEC-033 | Possible dependency confusion | material | engineering | Internal package names resolvable from public registries can be hijacked. |
| SEC-034 | Dependency names resembling popular packages | material | engineering | Inference only: near-miss names are a typosquatting signal worth checking. |

## 4. What the rules deliberately do not do

- **Legal conclusions.** Copyleft findings depend on the declared distribution model, and the output is a question for counsel.
- **Snippet matching** against the world's open-source code. Q-OWN-2 says so in its rationale when satisfied. This is Black Duck's strength; we don't pretend to have it.
- **Rebuilding the software.** Q-REP-1 says whether inputs are declared and pinned, not whether a rebuild reproduces the shipped artifact.
- **Runtime, infrastructure, data handling or code quality.** These are out of scope, and the readiness scope statement says so.
