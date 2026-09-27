import type { Area, Audience, Materiality } from './model.js';

export interface RuleDef {
  version: number;
  area: Area;
  title: string;
  materiality: Materiality;
  audience: Audience[];
  /** One line on why a buyer, counsel or engineer cares. */
  why: string;
}

/**
 * Every finding the engine can emit. Changing a rule's logic or threshold
 * requires bumping its version (and RULES_VERSION), because the dossier digest
 * must change when the analysis changes.
 */
export const RULES = {
  // Ownership and chain of title
  'OWN-001': { version: 1, area: 'ownership', title: 'Contributors without a recorded IP agreement', materiality: 'material', audience: ['counsel', 'management'], why: 'Code written without an assignment may not belong to the company.' },
  'OWN-002': { version: 1, area: 'ownership', title: 'Contributions predate the recorded agreement', materiality: 'material', audience: ['counsel'], why: 'An agreement signed after the work may not cover earlier contributions unless it assigns prior work.' },
  'OWN-003': { version: 1, area: 'ownership', title: 'Contributors using personal or external email identities', materiality: 'material', audience: ['counsel', 'management'], why: 'Buyers ask for IP assignments from every contributor; personal and external identities are the ones most often missing.' },
  'OWN-004': { version: 1, area: 'ownership', title: 'Third-party copyright notices in first-party source', materiality: 'material', audience: ['counsel', 'engineering'], why: 'Code carrying another owner\'s notice was copied in and brings that owner\'s license terms.' },
  'OWN-005': { version: 1, area: 'ownership', title: 'Stack Overflow references in source', materiality: 'material', audience: ['counsel', 'engineering'], why: 'Stack Overflow content is licensed CC BY-SA; copied snippets carry attribution and share-alike terms.' },
  'OWN-006': { version: 1, area: 'ownership', title: 'Comments stating code was copied or adapted from a URL', materiality: 'minor', audience: ['counsel', 'engineering'], why: 'Copied code brings the source\'s license terms.' },
  'OWN-007': { version: 1, area: 'ownership', title: 'File-level license identifiers differing from the project', materiality: 'material', audience: ['counsel'], why: 'A file under a different license (e.g. GPL) inside a proprietary codebase needs review.' },
  'OWN-008': { version: 1, area: 'provenance', title: 'History begins with a bulk import', materiality: 'material', audience: ['management', 'counsel'], why: 'Code that arrived in one commit has no recorded authorship before that point.' },
  'OWN-009': { version: 1, area: 'evidence_quality', title: 'Incomplete git history', materiality: 'material', audience: ['engineering'], why: 'Ownership and provenance conclusions only cover the history that was available.' },
  'OWN-010': { version: 1, area: 'ownership', title: 'Submodules outside this repository', materiality: 'minor', audience: ['engineering', 'counsel'], why: 'Submodule contents are owned and licensed elsewhere and were not analysed.' },
  'OWN-011': { version: 1, area: 'licenses', title: 'Vendored code without a license file', materiality: 'material', audience: ['counsel'], why: 'Third-party code with no license gives no right to use it.' },

  // AI development evidence
  'AI-001': { version: 1, area: 'ai_development', title: 'AI coding tools used in this repository', materiality: 'info', audience: ['management', 'counsel'], why: 'Buyers ask which AI tools were used, on which code, and under which terms.' },
  'AI-002': { version: 1, area: 'ai_development', title: 'Declaration contradicts recorded AI evidence', materiality: 'material', audience: ['management', 'counsel'], why: 'A disclosure that the evidence contradicts is worse than no disclosure.' },
  'AI-003': { version: 1, area: 'ai_development', title: 'Attribution sources disagree', materiality: 'material', audience: ['engineering', 'management'], why: 'Two attribution records claim different origins for the same lines.' },
  'AI-004': { version: 1, area: 'evidence_quality', title: 'Attribution records that cannot be checked', materiality: 'minor', audience: ['engineering'], why: 'Records referencing commits or lines that do not exist carry no weight.' },
  'AI-005': { version: 1, area: 'ai_development', title: 'AI-attributed changes without review evidence', materiality: 'material', audience: ['management', 'engineering'], why: 'Acquirers ask what share of AI-written code was reviewed by a human who understood it.' },
  'AI-006': { version: 1, area: 'ai_development', title: 'Large unattributed changes after AI tools were adopted', materiality: 'minor', audience: ['management'], why: 'Inference only: worth asking how these changes were produced. Not evidence of AI origin.' },
  'AI-008': { version: 1, area: 'ai_development', title: 'AI tool terms not declared', materiality: 'material', audience: ['counsel'], why: 'IP indemnities and output terms depend on the plan tier and settings used.' },
  'AI-009': { version: 1, area: 'evidence_quality', title: 'AI tools configured but attribution not recorded', materiality: 'material', audience: ['management', 'engineering'], why: 'Tool use is indicated but which code it produced was not recorded; origin stays unknown.' },
  'AI-011': { version: 1, area: 'ai_development', title: 'Files predominantly attributed to AI with no recorded human authorship', materiality: 'material', audience: ['counsel'], why: 'Copyright requires human authorship; counsel should know where records show little or none.' },
  'AI-013': { version: 1, area: 'ai_development', title: 'Editor-inserted AI co-author trailers (corroborating only)', materiality: 'minor', audience: ['management', 'engineering'], why: 'An editor can add an AI co-author trailer from its own telemetry, including where no AI output was used; it cannot establish which code AI produced.' },
  'AI-012': { version: 1, area: 'provenance', title: 'Model weights or binary model artifacts committed', materiality: 'material', audience: ['counsel', 'engineering'], why: 'Model artifacts carry training-data and license provenance that the repository cannot show.' },

  // Licenses
  'LIC-002': { version: 1, area: 'licenses', title: 'Project license declarations disagree', materiality: 'material', audience: ['counsel'], why: 'The license a buyer believes applies must be unambiguous.' },
  'LIC-003': { version: 1, area: 'licenses', title: 'Project published under a copyleft license', materiality: 'material', audience: ['counsel', 'management'], why: 'Confirm the licensing intent for the company\'s own code.' },
  'LIC-010': { version: 1, area: 'licenses', title: 'Strong or network copyleft in production dependencies', materiality: 'material', audience: ['counsel'], why: 'Copyleft obligations depend on how the software is distributed.' },
  'LIC-011': { version: 1, area: 'licenses', title: 'Weak copyleft in production dependencies', materiality: 'minor', audience: ['counsel'], why: 'Weak copyleft usually requires notices and keeping modifications open.' },
  'LIC-012': { version: 1, area: 'licenses', title: 'Source-available or restrictive licenses in production dependencies', materiality: 'material', audience: ['counsel'], why: 'Non-open-source licenses can restrict competing or hosted use.' },
  'LIC-013': { version: 1, area: 'licenses', title: 'Production dependencies with unknown licenses', materiality: 'material', audience: ['counsel', 'engineering'], why: 'An unknown license is an unanswered question in the disclosure schedule.' },
  'LIC-014': { version: 1, area: 'licenses', title: 'Non-standard license text', materiality: 'material', audience: ['counsel'], why: 'Custom or modified license text needs legal reading.' },

  // Security exposure
  'SEC-001': { version: 1, area: 'security', title: 'Credentials in the current code', materiality: 'blocking', audience: ['engineering', 'management'], why: 'A live credential in the code is an active exposure.' },
  'SEC-002': { version: 1, area: 'security', title: 'Credentials in git history', materiality: 'material', audience: ['engineering'], why: 'Removed secrets remain retrievable from every clone until rotated.' },
  'SEC-003': { version: 1, area: 'security', title: 'Environment files committed', materiality: 'material', audience: ['engineering'], why: 'Committed .env files usually contain credentials or internal endpoints.' },
  'SEC-010': { version: 1, area: 'security', title: 'Known high or critical vulnerabilities in production dependencies', materiality: 'material', audience: ['engineering'], why: 'Material vulnerabilities must be understood before close.' },
  'SEC-011': { version: 1, area: 'security', title: 'Dependency flagged as malicious', materiality: 'blocking', audience: ['engineering', 'management'], why: 'A known-malicious package in the dependency tree is an incident, not a finding.' },
  'SEC-020': { version: 1, area: 'security', title: 'CI workflow runs untrusted pull request code with privileges', materiality: 'material', audience: ['engineering'], why: 'pull_request_target with a checkout of the PR head exposes secrets and write tokens.' },
  'SEC-021': { version: 1, area: 'security', title: 'CI script injection from untrusted input', materiality: 'material', audience: ['engineering'], why: 'Attacker-controlled titles or branch names are interpolated into shell commands.' },
  'SEC-022': { version: 1, area: 'security', title: 'Third-party CI actions not pinned to a commit', materiality: 'minor', audience: ['engineering'], why: 'A moved tag changes what runs in the pipeline.' },
  'SEC-023': { version: 1, area: 'security', title: 'Pipelines pipe remote scripts to a shell', materiality: 'minor', audience: ['engineering'], why: 'The build depends on unpinned remote code.' },
  'SEC-024': { version: 1, area: 'security', title: 'CI token granted write-all permissions', materiality: 'minor', audience: ['engineering'], why: 'Broad tokens widen the blast radius of any pipeline compromise.' },
  'SEC-025': { version: 1, area: 'security', title: 'CI prints secrets', materiality: 'material', audience: ['engineering'], why: 'Secrets written to logs are exposed to anyone who can read the logs.' },
  'SEC-030': { version: 1, area: 'security', title: 'Production dependencies run install scripts', materiality: 'minor', audience: ['engineering'], why: 'Install scripts execute arbitrary code at build time.' },
  'SEC-031': { version: 1, area: 'security', title: 'Dependencies fetched over plain HTTP', materiality: 'material', audience: ['engineering'], why: 'Unencrypted downloads can be tampered with in transit.' },
  'SEC-032': { version: 1, area: 'security', title: 'Lockfile entries without integrity hashes', materiality: 'minor', audience: ['engineering'], why: 'Without integrity hashes, a changed package is not detected at install.' },
  'SEC-033': { version: 1, area: 'security', title: 'Possible dependency confusion', materiality: 'material', audience: ['engineering'], why: 'Internal package names resolvable from public registries can be hijacked.' },
  'SEC-034': { version: 1, area: 'security', title: 'Dependency names resembling popular packages', materiality: 'material', audience: ['engineering'], why: 'Inference only: near-miss names are a typosquatting signal worth checking.' },

  // Reproducibility
  'REP-001': { version: 1, area: 'reproducibility', title: 'Dependencies declared without a lockfile', materiality: 'material', audience: ['engineering'], why: 'Without a lockfile the exact dependency set cannot be rebuilt.' },
  'REP-002': { version: 1, area: 'reproducibility', title: 'Manifest and lockfile disagree', materiality: 'material', audience: ['engineering'], why: 'Drift means the lockfile does not describe what the manifest asks for.' },
  'REP-003': { version: 1, area: 'reproducibility', title: 'Unpinned dependency sources', materiality: 'minor', audience: ['engineering'], why: 'Git branches, URLs and "latest" resolve to different code over time.' },
  'REP-004': { version: 1, area: 'reproducibility', title: 'Container base images not pinned', materiality: 'minor', audience: ['engineering'], why: 'Tags move; only digests identify an image.' },
  'REP-005': { version: 1, area: 'reproducibility', title: 'No CI configuration', materiality: 'material', audience: ['engineering', 'management'], why: 'The build process is not recorded anywhere a buyer can inspect.' },
  'REP-006': { version: 1, area: 'reproducibility', title: 'Toolchain versions not pinned', materiality: 'minor', audience: ['engineering'], why: 'Unpinned runtimes change build output.' },
  'REP-007': { version: 1, area: 'reproducibility', title: 'Build outputs committed to the repository', materiality: 'minor', audience: ['engineering'], why: 'Committed artifacts may not match the source they claim to come from.' },
  'REP-008': { version: 1, area: 'reproducibility', title: 'Executable binaries committed', materiality: 'material', audience: ['engineering', 'counsel'], why: 'Binaries are opaque: their origin, license and contents cannot be established from the repository.' },

  // Maintainability
  'MNT-001': { version: 1, area: 'maintainability', title: 'Key-person concentration', materiality: 'material', audience: ['management'], why: 'Most recent work depends on one person.' },
  'MNT-002': { version: 1, area: 'maintainability', title: 'Few or no tests', materiality: 'minor', audience: ['engineering'], why: 'Changes cannot be verified automatically.' },
  'MNT-003': { version: 1, area: 'maintainability', title: 'No README', materiality: 'minor', audience: ['engineering'], why: 'New owners have no entry point.' },
  'MNT-004': { version: 1, area: 'maintainability', title: 'Production dependencies without recent releases', materiality: 'minor', audience: ['engineering'], why: 'Unmaintained dependencies stop receiving security fixes.' },
  'MNT-007': { version: 1, area: 'maintainability', title: 'No recent activity', materiality: 'minor', audience: ['management', 'engineering'], why: 'The repository has not changed in over a year.' },

  // Product dependence on AI providers
  'AID-001': { version: 1, area: 'ai_dependency', title: 'Product depends on external AI providers', materiality: 'material', audience: ['management', 'engineering'], why: 'Pricing, terms or model deprecations at a provider change the product.' },
  'AID-002': { version: 1, area: 'ai_dependency', title: 'Hard-coded model identifiers', materiality: 'minor', audience: ['engineering'], why: 'Pinned model versions are retired on the provider\'s schedule.' },

  // Evidence quality
  'EVQ-002': { version: 1, area: 'evidence_quality', title: 'Declarations older than the code they describe', materiality: 'material', audience: ['management'], why: 'A declaration made before the code changed no longer speaks to it.' },
  'EVQ-003': { version: 1, area: 'evidence_quality', title: 'Uncommitted changes were not analysed', materiality: 'info', audience: ['engineering'], why: 'The dossier describes a commit, not the working copy.' },
} as const satisfies Record<string, RuleDef>;

export type RuleId = keyof typeof RULES;

export function rule(id: RuleId): RuleDef {
  return RULES[id];
}
