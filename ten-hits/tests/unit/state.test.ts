import { describe, expect, it } from 'vitest';
import { applyImpact, createRunState } from '../../src/game/state';

describe('run lifecycle', () => {
  it('does not count a miss and raises anger', () => {
    const next = applyImpact(createRunState(7), 'miss', false);
    expect(next.validHits).toBe(0);
    expect(next.anger).toBe(1);
    expect(next.extraAttackQueued).toBe(true);
  });

  it('counts a graze and lowers anger', () => {
    const angry = { ...createRunState(7), anger: 3 };
    const next = applyImpact(angry, 'graze', false);
    expect(next.validHits).toBe(1);
    expect(next.anger).toBe(2);
  });

  it('wins on the tenth valid contact and loses on rupture', () => {
    const ninth = { ...createRunState(7), validHits: 9 };
    expect(applyImpact(ninth, 'graze', false).phase).toBe('won');
    expect(applyImpact(createRunState(7), 'center-compression', true).phase).toBe('lost');
  });

  it('lets rupture override the tenth valid contact', () => {
    const ninth = { ...createRunState(7), validHits: 9 };
    expect(applyImpact(ninth, 'center-compression', true).phase).toBe('lost');
  });

  it('clamps anger between zero and five', () => {
    let state = createRunState(7);
    for (let i = 0; i < 9; i += 1) state = applyImpact(state, 'miss', false);
    expect(state.anger).toBe(5);
    let calm = { ...createRunState(7), anger: 0 };
    calm = applyImpact(calm, 'graze', false);
    expect(calm.anger).toBe(0);
  });

  it('never mutates the input state', () => {
    const start = createRunState(7);
    applyImpact(start, 'graze', false);
    expect(start.validHits).toBe(0);
    expect(start.attackIndex).toBe(0);
  });

  it('counts every attack including misses', () => {
    let state = createRunState(3);
    state = applyImpact(state, 'miss', false);
    state = applyImpact(state, 'graze', false);
    expect(state.attackIndex).toBe(2);
    expect(state.validHits).toBe(1);
    expect(state.extraAttackQueued).toBe(false);
  });
});
