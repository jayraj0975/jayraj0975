/**
 * Plans are hypotheses under test (see docs/DECISIONS.md D9). Limits are
 * enforced server-side; prices are shown exactly as charged.
 */
export interface Plan {
  id: 'free' | 'readiness' | 'custody' | 'acquirer' | 'enterprise';
  name: string;
  price: string;
  cadence: string;
  audience: string;
  features: string[];
  limits: { repositories: number; hostedScansPerMonth: number; shareLinks: boolean; monitoring: boolean; platformAttestation: boolean };
  checkout: { mode: 'payment' | 'subscription'; amountCents: number; interval?: 'month' } | null;
}

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Local',
    price: '$0',
    cadence: 'forever',
    audience: 'Engineers and CI',
    features: ['CLI and CI analysis where the code lives', 'Full dossier, JSON, CycloneDX SBOM', 'Self-signed attestations', 'One hosted repository to try the workflow'],
    limits: { repositories: 1, hostedScansPerMonth: 5, shareLinks: false, monitoring: false, platformAttestation: true },
    checkout: null,
  },
  {
    id: 'readiness',
    name: 'Readiness',
    price: '$1,500',
    cadence: 'per dossier, 90 days',
    audience: 'Companies preparing for a sale or a late-stage raise',
    features: ['Up to 10 repositories', 'Platform-attested dossier buyers can verify', 'Share links for buyers and counsel', 'Unlimited re-scans for 90 days', 'Change reports between snapshots'],
    limits: { repositories: 10, hostedScansPerMonth: 500, shareLinks: true, monitoring: true, platformAttestation: true },
    checkout: { mode: 'payment', amountCents: 150_000 },
  },
  {
    id: 'custody',
    name: 'Custody',
    price: '$490',
    cadence: 'per month',
    audience: 'Companies within two years of a raise or exit; post-close integration',
    features: ['Up to 25 repositories', 'Continuous monitoring on every push', 'Signed snapshot history (chain of custody)', 'Material-change alerts', 'Share links'],
    limits: { repositories: 25, hostedScansPerMonth: 2000, shareLinks: true, monitoring: true, platformAttestation: true },
    checkout: { mode: 'subscription', amountCents: 49_000, interval: 'month' },
  },
  {
    id: 'acquirer',
    name: 'Acquirer',
    price: '$2,500',
    cadence: 'per month',
    audience: 'Aggregators, search funds and PE running several deals',
    features: ['Up to 6 active targets', 'Receive and verify target dossiers', 'Portfolio view across targets', 'Change reports during the process'],
    limits: { repositories: 60, hostedScansPerMonth: 3000, shareLinks: true, monitoring: true, platformAttestation: true },
    checkout: { mode: 'subscription', amountCents: 250_000, interval: 'month' },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    cadence: '',
    audience: '400-repository targets, self-hosted workers, SSO',
    features: ['Self-hosted analysis workers', 'Organisation-wide contributor register', 'API', 'SSO and custom retention'],
    limits: { repositories: 100_000, hostedScansPerMonth: 1_000_000, shareLinks: true, monitoring: true, platformAttestation: true },
    checkout: null,
  },
];

export function planFor(id: string): Plan {
  return PLANS.find((p) => p.id === id) ?? PLANS[0]!;
}
