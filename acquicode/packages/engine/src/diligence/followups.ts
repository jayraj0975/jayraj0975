import type { Area, Audience } from '../model.js';
import type { RuleId } from '../rules.js';

/** The request each finding turns into, addressed to the people who can answer it. */
export const FOLLOW_UPS: Partial<Record<RuleId, Array<[Audience, string]>>> = {
  'OWN-001': [['counsel', 'Obtain executed IP assignment agreements, or confirmatory assignments, from each contributor listed without one.']],
  'OWN-002': [['counsel', 'Confirm that the agreements of contributors who committed before signing assign work created before the signing date.']],
  'OWN-003': [['management', 'Provide the IP assignment agreement for each contributor listed, keyed by the email address they committed under.']],
  'OWN-004': [['counsel', 'Identify the origin and license of the files carrying third-party copyright notices, and whether their obligations are met.']],
  'OWN-005': [
    ['engineering', 'Identify code copied from the referenced Stack Overflow posts; attribute it under CC BY-SA or rewrite it.'],
    ['counsel', 'Assess CC BY-SA attribution and share-alike obligations for the copied snippets.'],
  ],
  'OWN-006': [['engineering', 'Identify the source and license of each piece of code marked as copied or adapted from an external URL.']],
  'OWN-007': [['counsel', 'Review the files whose SPDX headers declare a license different from the project license.']],
  'OWN-008': [['management', 'Explain where the code in the initial bulk commit came from and who wrote it; provide the prior repository if one exists.']],
  'OWN-009': [['engineering', 'Provide a complete (non-shallow) clone so the full history can be analysed.']],
  'OWN-010': [['engineering', 'Provide each submodule repository for analysis.'], ['counsel', 'Confirm the ownership and license of each submodule.']],
  'OWN-011': [['counsel', 'Establish the license of each vendored directory that has no license file.']],
  'AI-001': [['management', 'Confirm the AI coding tools used, the accounts and plans they were used under, and the period of use.']],
  'AI-002': [['management', 'Reconcile the AI usage declaration with the recorded evidence and correct the disclosure.']],
  'AI-003': [['engineering', 'Explain why the attribution records disagree for the listed files and which record is correct.']],
  'AI-004': [['engineering', 'Explain the attribution records that reference commits, files or lines that do not exist.']],
  'AI-005': [['management', 'Describe the review process for AI-generated changes and provide review records for the listed commits.']],
  'AI-006': [['management', 'Explain how the large unattributed changes listed were produced.']],
  'AI-008': [['counsel', 'Provide the terms (plan tier, IP indemnity, output-filter settings) under which each AI tool was used.']],
  'AI-009': [
    ['management', 'Identify which parts of the code were produced with the configured AI tools.'],
    ['engineering', 'Record attribution going forward (git-ai notes or Agent Trace) and push refs/notes/* with the code.'],
  ],
  'AI-011': [['counsel', 'Assess the copyright position of files whose recorded authorship is predominantly AI, and whether human contribution is documented elsewhere.']],
  'AI-013': [['management', 'Confirm whether GitHub Copilot was enabled in VS Code for the listed commits, and which git.addAICoAuthor setting and VS Code version applied.']],
  'AI-012': [['counsel', 'Document the source, training data and license of each committed model artifact.']],
  'LIC-002': [['counsel', 'Resolve which license applies to the company\'s own code and correct the conflicting declaration.']],
  'LIC-003': [['management', 'Confirm the intended license of this repository.']],
  'LIC-010': [['counsel', 'Assess obligations under the listed copyleft licenses given how the software is distributed; plan remediation if required.']],
  'LIC-011': [['counsel', 'Confirm notice and modification-disclosure obligations for weak-copyleft dependencies are met.']],
  'LIC-012': [['counsel', 'Review the source-available licenses listed for restrictions on the company\'s use.']],
  'LIC-013': [['engineering', 'Establish licenses for the listed dependencies (run with registry enrichment or provide an SBOM).']],
  'LIC-014': [['counsel', 'Read the non-standard license text and confirm its effect.']],
  'SEC-001': [['engineering', 'Rotate the exposed credentials, remove them from the code and confirm rotation dates.']],
  'SEC-002': [['engineering', 'Confirm that the credentials found in history were rotated, with dates.']],
  'SEC-003': [['engineering', 'Remove committed environment files and rotate any credentials they contained.']],
  'SEC-010': [['engineering', 'Provide a remediation plan or reachability assessment for the listed advisories.']],
  'SEC-011': [['engineering', 'Treat as an incident: establish how the malicious package entered and whether it ran in any environment.']],
  'SEC-020': [['engineering', 'Stop running pull request code under pull_request_target, or isolate it from secrets and write tokens.']],
  'SEC-021': [['engineering', 'Pass untrusted event fields through environment variables instead of interpolating them into run: scripts.']],
  'SEC-022': [['engineering', 'Pin third-party actions to full commit SHAs.']],
  'SEC-023': [['engineering', 'Replace piped remote scripts with pinned, checksummed downloads.']],
  'SEC-024': [['engineering', 'Set least-privilege permissions on workflow tokens.']],
  'SEC-025': [['engineering', 'Stop printing secrets in CI and rotate any that were logged.']],
  'SEC-030': [['engineering', 'Review the install scripts of the listed production dependencies.']],
  'SEC-031': [['engineering', 'Fetch all dependencies over HTTPS.']],
  'SEC-032': [['engineering', 'Regenerate lockfiles so every entry carries an integrity hash.']],
  'SEC-033': [['engineering', 'Scope private packages and configure registries so internal names cannot resolve publicly.']],
  'SEC-034': [['engineering', 'Confirm that each near-miss dependency name is the intended package.']],
  'REP-001': [['engineering', 'Commit a lockfile for each manifest listed.']],
  'REP-002': [['engineering', 'Regenerate the lockfiles that no longer match their manifests.']],
  'REP-003': [['engineering', 'Pin git, URL and floating dependency references to immutable versions or commits.']],
  'REP-004': [['engineering', 'Pin container base images by digest.']],
  'REP-005': [['engineering', 'Provide the build process: pipeline definitions, or build documentation and recent build logs.']],
  'REP-006': [['engineering', 'Pin runtime and toolchain versions.']],
  'REP-007': [['engineering', 'Explain why build outputs are committed and how they are kept in sync with source.']],
  'REP-008': [['engineering', 'Provide the source, version and license of each committed binary, or remove it.']],
  'MNT-001': [['management', 'Describe knowledge transfer and retention arrangements for the key contributor.']],
  'MNT-002': [['engineering', 'Describe how changes are verified in the absence of automated tests.']],
  'MNT-003': [['engineering', 'Provide onboarding documentation for the repository.']],
  'MNT-004': [['engineering', 'Plan replacements for dependencies that are no longer released.']],
  'MNT-007': [['management', 'Confirm whether this repository is still in use.']],
  'AID-001': [['management', 'Describe the contract terms, pricing exposure and fallback plan for each AI provider the product calls.']],
  'AID-002': [['engineering', 'Describe how the product migrates when pinned model versions are retired.']],
  'EVQ-002': [['management', 'Update the origin declarations to cover the code as it is now.']],
};

export function audienceForArea(area: Area): Audience {
  switch (area) {
    case 'ownership':
    case 'licenses':
      return 'counsel';
    case 'ai_development':
    case 'provenance':
    case 'ai_dependency':
    case 'change_history':
      return 'management';
    default:
      return 'engineering';
  }
}
