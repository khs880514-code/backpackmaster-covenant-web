import { FIXED_STEP, MAX_SUBSTEPS, POSES, SHOES, powerProfile } from './config';
import {
  crackingFactor,
  createTargetState,
  proxyStage,
  recoverTarget,
  resolveImpact,
  squashFactor
} from './impact';
import { createPendulumPair, stepPendulum } from './pendulum';
import { clampPelvis } from './pose';
import { mixSeed, mulberry32 } from './random';
import { sampleFootPath, selectAttack, FOOT_REST_POSITION } from './attack-director';
import { angerMood, applyImpact, createRunState, hitDots, runResult } from './state';
import type {
  AttackPlan,
  CameraPhase,
  GamePhase,
  GameSnapshot,
  ImpactGrade,
  PendulumPair,
  PoseId,
  ProxySnapshot,
  ShoeId,
  ShoeProfile,
  TargetSide,
  TargetState,
  Vec2,
  Vec3
} from './types';

export interface ContactContext {
  foot: Vec3;
  left: Vec3;
  right: Vec3;
  shoe: ShoeProfile;
  plan: AttackPlan;
}

export interface ContactOutcome {
  grade: ImpactGrade;
  contacted: TargetSide;
}

export type ContactResolver = (context: ContactContext) => ContactOutcome;

export interface EngineOptions {
  pose: PoseId;
  shoe: ShoeId;
  power: number;
  seed: number;
  resolveContact?: ContactResolver;
}

export interface GameEngine {
  update(realDelta: number): GameSnapshot;
  snapshot(): GameSnapshot;
  movePelvis(input: Vec2): void;
  start(): void;
  startAttack(): void;
  attackCount(): number;
  simulationTime(): number;
}

const IMPACT_HOLD = 0.25;
const TARGET_RADIUS = 0.085;
const DEPTH_TO_Z = 0.3;

/** Default geometric contact test, replaced by an adapter in unit tests. */
export const geometricContact: ContactResolver = ({ foot, left, right, shoe }) => {
  const reach = TARGET_RADIUS * shoe.contactWidth + 0.055;
  const distance = (t: Vec3): number =>
    Math.hypot(foot.x - t.x, foot.y - t.y, (foot.z - t.z) * 0.6);
  const dl = distance(left);
  const dr = distance(right);
  const contacted: TargetSide = dl <= dr ? 'left' : 'right';
  const near = Math.min(dl, dr);

  if (near > reach * 2.4) return { grade: 'miss', contacted };
  if (dl <= reach * 1.05 && dr <= reach * 1.05) {
    return { grade: 'center-compression', contacted };
  }
  if (near <= reach * 0.8) return { grade: 'single-compression', contacted };
  return { grade: 'graze', contacted };
};

export function createGameEngine(options: EngineOptions): GameEngine {
  const pose = POSES[options.pose];
  const shoe = SHOES[options.shoe];
  const power = powerProfile(options.power);
  const resolveContact = options.resolveContact ?? geometricContact;

  let run = createRunState(options.seed);
  let pair: PendulumPair = createPendulumPair();
  let left: TargetState = createTargetState();
  let right: TargetState = createTargetState();

  let requestedPelvis: Vec2 = { x: 0, y: 0 };
  let pelvis: Vec2 = { x: 0, y: 0 };
  let drift: Vec2 = { x: 0, y: 0 };

  let plan: AttackPlan | null = null;
  let phaseTime = 0;
  let accumulator = 0;
  let simTime = 0;
  let lastGrade: ImpactGrade | null = null;
  let footWorld: Vec3 = { ...FOOT_REST_POSITION };

  function targetWorld(side: TargetSide): Vec3 {
    const body = side === 'left' ? pair.left : pair.right;
    return {
      x: body.position.x,
      y: pose.anchorHeight + body.position.y,
      z: pelvis.y * DEPTH_TO_Z
    };
  }

  function predictTarget(lookahead: number): Vec2 {
    const cx = (pair.left.position.x + pair.right.position.x) / 2;
    const cy = (pair.left.position.y + pair.right.position.y) / 2;
    const vx = (pair.left.velocity.x + pair.right.velocity.x) / 2;
    const vy = (pair.left.velocity.y + pair.right.velocity.y) / 2;
    return { x: cx + vx * lookahead, y: cy + vy * lookahead };
  }

  function buildPlan(): AttackPlan {
    return selectAttack({
      validHits: run.validHits,
      anger: run.anger,
      seed: mixSeed(run.seed, run.attackIndex * 13 + 5),
      pose,
      shoe,
      power,
      predictedTarget: predictTarget(0.28),
      recentPlayerDrift: drift,
      leftDamage: Math.max(left.permanent, left.fatigue),
      rightDamage: Math.max(right.permanent, right.fatigue)
    });
  }

  function beginTelegraph(): void {
    plan = buildPlan();
    run = { ...run, phase: 'telegraph' };
    phaseTime = 0;
  }

  function phaseDuration(phase: GamePhase): number {
    if (!plan) return 1;
    switch (phase) {
      case 'telegraph':
        return plan.telegraphDuration;
      case 'strike':
        return plan.strikeDuration;
      case 'impact':
        return IMPACT_HOLD;
      case 'recovery':
        return plan.recoveryDuration;
      default:
        return 1;
    }
  }

  /** Returns the phase the run settles into after the contact is folded in. */
  function resolveNow(): GamePhase {
    if (!plan) return run.phase;
    const outcome = resolveContact({
      foot: footWorld,
      left: targetWorld('left'),
      right: targetWorld('right'),
      shoe,
      plan
    });

    const random = mulberry32(mixSeed(run.seed, run.attackIndex * 31 + 17));
    const result = resolveImpact({
      grade: outcome.grade,
      contacted: outcome.contacted,
      anger: run.anger,
      shoe,
      power,
      left,
      right,
      random
    });

    left = result.left;
    right = result.right;
    lastGrade = outcome.grade;
    run = applyImpact(run, outcome.grade, result.ruptured);
    return run.phase;
  }

  function advancePhase(): void {
    switch (run.phase) {
      case 'telegraph':
        run = { ...run, phase: 'strike' };
        phaseTime = 0;
        break;
      case 'strike': {
        const settled = resolveNow();
        if (settled !== 'won' && settled !== 'lost') {
          run = { ...run, phase: 'impact' };
        }
        phaseTime = 0;
        break;
      }
      case 'impact':
        run = { ...run, phase: 'recovery' };
        phaseTime = 0;
        lastGrade = null;
        break;
      case 'recovery':
        beginTelegraph();
        break;
      default:
        break;
    }
  }

  function step(dt: number): void {
    simTime += dt;

    // Pelvis eases toward the requested position so flicks read as motion.
    pelvis = {
      x: pelvis.x + (requestedPelvis.x - pelvis.x) * Math.min(1, dt * 14),
      y: pelvis.y + (requestedPelvis.y - pelvis.y) * Math.min(1, dt * 14)
    };
    const before = drift;
    drift = {
      x: before.x * 0.97 + (requestedPelvis.x - pelvis.x) * 0.6,
      y: before.y * 0.97 + (requestedPelvis.y - pelvis.y) * 0.6
    };

    pair = stepPendulum(pair, { x: pelvis.x, y: 0 }, dt);

    if (run.phase === 'setup' || run.phase === 'won' || run.phase === 'lost') return;

    phaseTime += dt;

    if (run.phase === 'strike' && plan) {
      footWorld = sampleFootPath(plan, phaseTime / Math.max(dt, plan.strikeDuration));
    } else if (run.phase === 'telegraph' && plan) {
      const ease = Math.min(1, phaseTime / Math.max(dt, plan.telegraphDuration));
      footWorld = sampleFootPath(plan, ease * 0.12);
    } else if (run.phase === 'recovery' || run.phase === 'impact') {
      left = recoverTarget(left, dt);
      right = recoverTarget(right, dt);
      if (run.phase === 'recovery' && plan) {
        const ease = Math.min(1, phaseTime / Math.max(dt, plan.recoveryDuration));
        const end = sampleFootPath(plan, 1);
        footWorld = {
          x: end.x + (FOOT_REST_POSITION.x - end.x) * ease,
          y: end.y + (FOOT_REST_POSITION.y - end.y) * ease,
          z: end.z + (FOOT_REST_POSITION.z - end.z) * ease
        };
      }
    }

    if (phaseTime >= phaseDuration(run.phase)) advancePhase();
  }

  function proxyOf(side: TargetSide, state: TargetState): ProxySnapshot {
    const body = side === 'left' ? pair.left : pair.right;
    return {
      side,
      stage: proxyStage(state),
      colorStage: state.colorStage,
      squash: squashFactor(state),
      cracking: crackingFactor(state),
      position: { x: body.position.x, y: body.position.y }
    };
  }

  function cameraPhase(): CameraPhase {
    if (run.phase === 'telegraph') return 'recentering';
    if (run.phase === 'strike' || run.phase === 'impact') return 'locked';
    return 'free-orbit';
  }

  function snapshot(): GameSnapshot {
    const duration = phaseDuration(run.phase);
    return {
      phase: run.phase,
      hitDots: hitDots(run),
      angerMood: angerMood(run),
      cameraPhase: cameraPhase(),
      result: runResult(run),
      proxies: [proxyOf('left', left), proxyOf('right', right)],
      anchor: { x: pelvis.x, y: pelvis.y },
      foot: { ...footWorld },
      attackKind: plan ? plan.kind : null,
      phaseProgress: duration > 0 ? Math.min(1, phaseTime / duration) : 0,
      lastGrade,
      pose: pose.id,
      shoe: shoe.id,
      power: power.level
    };
  }

  return {
    update(realDelta: number): GameSnapshot {
      accumulator += Math.max(0, Math.min(realDelta, 1));
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < MAX_SUBSTEPS) {
        step(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      // Drop the backlog instead of spiralling after a long tab stall.
      if (steps >= MAX_SUBSTEPS) accumulator = 0;
      return snapshot();
    },
    snapshot,
    movePelvis(input: Vec2): void {
      requestedPelvis = clampPelvis(input, pose);
    },
    start(): void {
      if (run.phase === 'setup') beginTelegraph();
    },
    startAttack(): void {
      beginTelegraph();
    },
    attackCount(): number {
      return run.attackIndex;
    },
    simulationTime(): number {
      return simTime;
    }
  };
}
