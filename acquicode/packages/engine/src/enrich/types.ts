/**
 * Network enrichment is optional. When a provider is absent, the sections that
 * depend on it are reported as UNKNOWN, never as clean. Every provider's
 * responses are recorded in the dossier so a verifier can replay them.
 */

export interface PackageRef {
  ecosystem: string;
  name: string;
  version: string;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

export interface VulnRecord {
  id: string;
  aliases: string[];
  summary: string;
  severity: Severity;
  cvssScore: number | null;
  malicious: boolean;
  fixedIn: string[];
  url: string;
  modified: string;
}

export interface VulnerabilityProvider {
  readonly name: string;
  /** Keyed by `${ecosystem}:${name}@${version}`. Missing keys mean "not queried". */
  query(pkgs: PackageRef[]): Promise<Map<string, VulnRecord[]>>;
}

export interface RegistryMetadata {
  exists: boolean;
  license: string | null;
  latestVersion: string | null;
  lastPublishedAt: string | null;
  maintainers: number | null;
  deprecated: string | null;
}

export interface RegistryProvider {
  readonly name: string;
  /** Keyed by `${ecosystem}:${name}`. */
  lookup(pkgs: Array<{ ecosystem: string; name: string }>): Promise<Map<string, RegistryMetadata>>;
}

export interface PullRequestReview {
  number: number;
  author: string | null;
  approvedBy: string[];
  state: 'merged' | 'closed' | 'open' | 'unknown';
}

export interface ForgeProvider {
  readonly name: string;
  pullRequests(numbers: number[]): Promise<Map<number, PullRequestReview>>;
}

export interface EnrichmentProviders {
  vulnerabilities?: VulnerabilityProvider;
  registry?: RegistryProvider;
}

/** Normalised enrichment responses, embedded in the dossier for replay. */
export interface EnrichmentCache {
  vulnerabilities?: { source: string; queriedAt: string; results: Record<string, VulnRecord[]> };
  registry?: { source: string; queriedAt: string; results: Record<string, RegistryMetadata> };
  forge?: { source: string; queriedAt: string; results: Record<string, PullRequestReview> };
}

export function pkgKey(p: PackageRef): string {
  return `${p.ecosystem}:${p.name}@${p.version}`;
}

export function nameKey(p: { ecosystem: string; name: string }): string {
  return `${p.ecosystem}:${p.name}`;
}
