import type { DependencyScope } from '../model.js';

export interface ParsedDependency {
  name: string;
  version: string | null;
  requirement?: string;
  direct: boolean;
  scope: DependencyScope;
  resolved?: string;
  integrity?: string;
  license?: string;
  hasInstallScript?: boolean;
  /** Source kind when not a registry package. */
  sourceKind?: 'registry' | 'git' | 'url' | 'path' | 'workspace';
  /** For git sources: whether the reference is pinned to a commit. */
  pinned?: boolean;
  line?: number;
}

export interface ManifestInfo {
  ecosystem: string;
  name: string;
  path: string;
  /** Direct dependencies as declared: name -> requirement and scope. */
  direct: Map<string, { requirement: string; scope: DependencyScope; line?: number }>;
  license?: string;
  private?: boolean;
  workspaces?: string[];
  toolchain?: string | null;
  scripts?: Record<string, string>;
}

export interface LockInfo {
  ecosystem: string;
  path: string;
  deps: ParsedDependency[];
  /** Manifest directories this lockfile covers (workspace roots). */
  importers?: Map<string, Map<string, string>>;
  format: string;
}

export const PINNED_REQUIREMENT = /^(=?=?\s*v?\d+\.\d+(\.\d+)?([-.+][0-9A-Za-z.-]+)?)$/;
