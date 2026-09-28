export * from './model.js';
export { analyze, dossierDigest, type RepositoryInput } from './analyze.js';
export { DEFAULT_LIMITS, type AnalyzeOptions, type Limits } from './context.js';
export { GitSource, DirectorySource, type RepoSource } from './source.js';
export { GitRepo, redactUrl } from './git/repo.js';
export { runGit, gitEnv, SAFE_CONFIG } from './git/run.js';
export {
  parseDeclarations,
  parseRegisterCsv,
  DeclarationError,
  DISTRIBUTION_MODELS,
  ORIGINS,
  AGREEMENTS,
  type Declarations,
} from './declarations.js';
export { canonicalJson, sha256Hex, stableId } from './canonical.js';
export { combineAll, combineAny, capAt, isSupported, strength } from './states.js';
export { RULES, type RuleId, type RuleDef } from './rules.js';
export { QUESTIONS, READINESS_SCOPE } from './diligence/questions.js';
export { renderDossierHtml, esc, type RenderOptions } from './dossier/html.js';
export { toCycloneDx } from './dossier/cyclonedx.js';
export {
  buildStatement,
  signStatement,
  verifyEnvelope,
  generateSigningKey,
  keyIdOf,
  pae,
  PAYLOAD_TYPE,
  type DsseEnvelope,
  type DossierStatement,
  type AttestationLevel,
  type VerifyResult,
} from './dossier/sign.js';
export { diffDossiers, type DossierDiff, type ChangeEvent } from './dossier/diff.js';
export { OsvProvider, PublicRegistryProvider, GitHubForgeProvider, replayProviders, normalizeOsv } from './enrich/providers.js';
export type { EnrichmentProviders, EnrichmentCache, VulnerabilityProvider, RegistryProvider, ForgeProvider, VulnRecord, RegistryMetadata, PullRequestReview } from './enrich/types.js';
export { cvss3BaseScore } from './enrich/cvss.js';
export { extractZipSafely, ZipError, DEFAULT_ZIP_LIMITS } from './util/zip.js';
export { parseAgentTrace, parseGitAiNote } from './provenance/formats.js';
export { commitSignals, matchAiIdentity } from './provenance/signals.js';
export { identifyLicenseText } from './licenses/identify.js';
export { normalizeLicense, parseExpression, effectiveCategories } from './licenses/spdx.js';
export { findSecrets, redactSecrets } from './analyzers/secrets.js';
export { checkInvariants, InvariantViolation } from './invariants.js';
export { ANALYZER_NAME, ANALYZER_VERSION, RULES_VERSION, DOSSIER_SCHEMA, PREDICATE_TYPE } from './version.js';
export type { SuppliedTrace } from './analyzers/ai.js';
