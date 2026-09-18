import { MAX_ANGER, REQUIRED_VALID_HITS } from './config';
import type { AngerMood, ImpactGrade, RunResult, RunState } from './types';

const MOODS: AngerMood[] = ['calm', 'annoyed', 'irritated', 'furious', 'seething'];

export function createRunState(seed: number): RunState {
  return {
    phase: 'setup',
    validHits: 0,
    anger: 0,
    extraAttackQueued: false,
    attackIndex: 0,
    seed,
    missCount: 0
  };
}

function clampAnger(value: number): number {
  return Math.min(MAX_ANGER, Math.max(0, value));
}

/**
 * Folds one resolved contact into the run. Always returns a new object so the
 * engine can publish immutable snapshots without defensive copies.
 *
 * A complete miss never counts toward the ten required contacts: it raises
 * anger and schedules one extra attack instead.
 */
export function applyImpact(
  state: RunState,
  grade: ImpactGrade,
  ruptured: boolean
): RunState {
  const attackIndex = state.attackIndex + 1;

  if (ruptured) {
    return {
      ...state,
      phase: 'lost',
      attackIndex,
      anger: clampAnger(state.anger + 1),
      extraAttackQueued: false
    };
  }

  if (grade === 'miss') {
    return {
      ...state,
      phase: 'recovery',
      attackIndex,
      missCount: state.missCount + 1,
      anger: clampAnger(state.anger + 1),
      extraAttackQueued: true
    };
  }

  const validHits = state.validHits + 1;
  return {
    ...state,
    phase: validHits >= REQUIRED_VALID_HITS ? 'won' : 'recovery',
    attackIndex,
    validHits,
    anger: clampAnger(state.anger - 1),
    extraAttackQueued: false
  };
}

/** Ten booleans, never a number, so the HUD cannot render a counter. */
export function hitDots(state: RunState): boolean[] {
  return Array.from({ length: REQUIRED_VALID_HITS }, (_, i) => i < state.validHits);
}

export function angerMood(state: RunState): AngerMood {
  const index = Math.min(MOODS.length - 1, Math.max(0, Math.round(state.anger * 0.8)));
  return MOODS[index] ?? 'calm';
}

export function runResult(state: RunState): RunResult {
  if (state.phase === 'won') return 'survived';
  if (state.phase === 'lost') return 'ruptured';
  return 'in-progress';
}

/** How many attacks this run still owes the player. */
export function attacksRemaining(state: RunState): number {
  const base = REQUIRED_VALID_HITS - state.validHits;
  return Math.max(0, base) + (state.extraAttackQueued ? 1 : 0);
}
