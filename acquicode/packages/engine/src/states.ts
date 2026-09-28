import type { ProvenanceState } from './model.js';

/**
 * Evidence strength, strongest first. Only these five states carry positive
 * support for a claim. The remaining four describe the absence or breakdown of
 * support and are never "upgraded" by combination.
 */
const STRENGTH: Record<ProvenanceState, number> = {
  VERIFIED: 5,
  OBSERVED: 4,
  DERIVED: 3,
  USER_ASSERTED: 2,
  INFERRED: 1,
  STALE: 0,
  UNVERIFIABLE: 0,
  CONFLICTING: 0,
  UNKNOWN: 0,
};

export function isSupported(state: ProvenanceState): boolean {
  return STRENGTH[state] > 0;
}

export function strength(state: ProvenanceState): number {
  return STRENGTH[state];
}

/**
 * The state of a claim derived from several inputs that must all hold
 * (conjunction). The result is never stronger than the weakest input, and a
 * derivation from observed facts is at most DERIVED.
 *
 * Precedence among non-supporting states: CONFLICTING > UNVERIFIABLE > STALE > UNKNOWN,
 * because a reader must see a contradiction before a mere gap.
 */
export function combineAll(states: ProvenanceState[]): ProvenanceState {
  if (states.length === 0) return 'UNKNOWN';
  for (const s of ['CONFLICTING', 'UNVERIFIABLE', 'STALE', 'UNKNOWN'] as const) {
    if (states.includes(s)) return s;
  }
  let weakest: ProvenanceState = 'VERIFIED';
  for (const s of states) if (STRENGTH[s] < STRENGTH[weakest]) weakest = s;
  // Computing something from facts does not make it a fact about the artifact.
  if (states.length > 1 && STRENGTH[weakest] > STRENGTH.DERIVED) return 'DERIVED';
  return weakest;
}

/**
 * The state of a claim supported by any one of several independent inputs
 * (disjunction), e.g. "this file has AI involvement" backed by two separate
 * records. Agreement cannot manufacture VERIFIED: the result is the strongest
 * supporting input. If inputs disagree the caller must use `conflict()`.
 */
export function combineAny(states: ProvenanceState[]): ProvenanceState {
  const supported = states.filter(isSupported);
  if (supported.length === 0) {
    if (states.includes('CONFLICTING')) return 'CONFLICTING';
    if (states.includes('UNVERIFIABLE')) return 'UNVERIFIABLE';
    if (states.includes('STALE')) return 'STALE';
    return 'UNKNOWN';
  }
  let best: ProvenanceState = supported[0]!;
  for (const s of supported) if (STRENGTH[s] > STRENGTH[best]) best = s;
  return best;
}

/** Downgrade a state to at most `cap` (e.g. anything learned from a user upload is at most USER_ASSERTED). */
export function capAt(state: ProvenanceState, cap: ProvenanceState): ProvenanceState {
  if (!isSupported(state)) return state;
  return STRENGTH[state] > STRENGTH[cap] ? cap : state;
}

/** Weakest of a set, used for roll-ups of evidence quality. */
export function weakest(states: ProvenanceState[]): ProvenanceState {
  return combineAll(states);
}
