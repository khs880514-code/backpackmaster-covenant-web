import {
  FIXED_STEP,
  MAX_SUBSTEPS,
  POSES,
  SHOES,
  SHOE_WIDTH_RANGE,
  powerProfile
} from './config';
import {
  crackingFactor,
  createTargetState,
  proxyStage,
  recoverTarget,
  resolveImpact,
  squashFactor
} from './impact';
import { applyImpulse, createPendulumPair, stepPendulum } from './pendulum';
import { clampPelvis } from './pose';
import { mixSeed, mulberry32 } from './random';
import { sampleFootPath, selectAttack, FOOT_REST_POSITION } from './attack-director';
import { angerMood, applyImpact, createRunState, hitDots, runResult } from './state';
import type {
  AttackPlan,
  CameraPhase,
  ContactPoint,
  GamePhase,
  GameSnapshot,
  ImpactGrade,
  PendulumPair,
  PoseId,
  PoseProfile,
  ProxyImprint,
  ProxySnapshot,
  ShoeId,
  ShoeProfile,
  TargetSide,
  TargetState,
  Vec2,
  Vec3
} from './types';

export interface ContactContext {
  /** The toe cap: the leading point of the striking surface. */
  foot: Vec3;
  /** The instep: the trailing end of it. */
  instep: Vec3;
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

/**
 * How far an off-centre contact tilts the dent away from the travel direction.
 * Small: the shoe's motion decides where it presses, its position only leans it.
 */
const OFFSET_LEAN = 0.35;

const IMPACT_HOLD = 0.25;

/**
 * How long the impact is held open, by grade.
 *
 * A quarter of a second is long enough to register that something happened and
 * far too short to read *what* — which is the whole complaint about not being
 * able to learn the dodge. A scored contact now stays on screen while the shoe
 * finishes pressing through, so the follow-through plays out slowly instead of
 * snapping. The attacker's clip is sampled from this same phase progress, so
 * lengthening the hold slows her motion to match at no extra cost.
 */
const REVIEW_HOLD: Record<ImpactGrade, number> = {
  miss: IMPACT_HOLD,
  graze: 0.55,
  'single-compression': 1.25,
  'center-compression': 1.6
};

/**
 * The hit that ends the run gets the longest look of all.
 *
 * It used to get none: a contact that won or lost skipped the impact phase
 * entirely and went straight to the result screen, so the one hit a player
 * most wants to understand was the one they never saw.
 */
const DECIDING_HOLD = 2.4;

function impactHold(grade: ImpactGrade | null, deciding: boolean): number {
  if (deciding) return DECIDING_HOLD;
  return grade === null ? IMPACT_HOLD : REVIEW_HOLD[grade];
}
const TARGET_RADIUS = 0.028;
const DEPTH_TO_Z = 0.12;
/**
 * How far in front of the pelvis the pair hangs, in world metres.
 *
 * Measured against the authored body: its front surface sits at 12.0cm at this
 * height, so anything closer than that is inside the figure. The procedural
 * capsule was thin enough to hide the problem; a real body is not.
 *
 * Both the target and the strike's aim carry this same offset, so the geometry
 * the contact test measures is unchanged by it.
 */
const PROXY_FORWARD = 0.138;

/** The pose's own offset, or the upright default. */
export function proxyForwardFor(pose: PoseProfile): number {
  return pose.proxyForward ?? PROXY_FORWARD;
}

/** Where the cords root. Upright, that is the same place the pair hangs from. */
export function tetherForwardFor(pose: PoseProfile): number {
  return pose.tetherForward ?? proxyForwardFor(pose);
}

/** How far the pair is laid over, in radians about X. */
export function proxyTiltFor(pose: PoseProfile): number {
  return ((pose.proxyTilt ?? 0) * Math.PI) / 180;
}

/**
 * Length of the striking surface, in world metres, measured between the
 * authored TOE_CAP and INSTEP anchors.
 *
 * A shoe does not hit with a point. Treating it as one let the player slide the
 * pair back along the foot and have a contact on the instep score as a dodge,
 * which is not what happens when someone is kicked.
 */
const STRIKE_SURFACE_LENGTH = 0.13;

/** Shortest distance from a point to the segment between two others. */
function distanceToSegment(point: Vec3, a: Vec3, b: Vec3, depthScale: number): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + aby * aby + abz * abz;
  let t = 0;
  if (lengthSq > 1e-9) {
    t = ((point.x - a.x) * abx + (point.y - a.y) * aby + (point.z - a.z) * abz) / lengthSq;
    t = Math.min(1, Math.max(0, t));
  }
  return Math.hypot(
    point.x - (a.x + abx * t),
    point.y - (a.y + aby * t),
    (point.z - (a.z + abz * t)) * depthScale
  );
}
/**
 * How far the pelvis actually travels, in world metres, at full pose range.
 * Pose profiles stay normalized 0..1 so they read as ratios; this is what
 * turns one of those ratios into a distance the shoe can miss by.
 */
/**
 * How far, in metres, a full sideways input shifts the hips.
 *
 * It was 0.45 — half a metre of lateral travel, which no one standing can do.
 * With the pair on real cords that much movement threw them clear of the shoe
 * entirely, so every dodge became a miss and a miss is not a survived hit. At
 * 0.10 a measured dodge grazes across a wide band of inputs (0.3 through 0.5
 * all survive), which is the window the game is played in. Measured, not
 * guessed: scripts read the grade distribution across eight seeds per value.
 */
const PELVIS_RANGE = 0.1;

/**
 * How far past the contact plane the shoe keeps travelling, in world metres.
 * A strike that stops dead on the surface reads as a tap; carrying through
 * toward the pelvis is what makes a heavy contact feel like it connected.
 */
function followThroughDepth(powerLevel: number): number {
  return 0.012 + Math.min(10, Math.max(1, powerLevel)) * 0.0062;
}

/** How hard a graded contact shoves the pair it just landed on. */
const IMPULSE_BY_GRADE: Record<ImpactGrade, number> = {
  miss: 0,
  graze: 0.18,
  'single-compression': 0.55,
  'center-compression': 0.8
};

/** Default geometric contact test, replaced by an adapter in unit tests. */
export {
  PELVIS_RANGE,
  PROXY_FORWARD,
  STRIKE_SURFACE_LENGTH,
  TARGET_RADIUS,
  followThroughDepth
};

export interface ContactBands {
  /** Inside this of a proxy centre is a direct compression. */
  compression: number;
  /** Out to this is a grazing contact; past it the shoe misses cleanly. */
  graze: number;
}

/**
 * The same numbers the contact test uses, exposed so the renderer can draw
 * the bands instead of guessing at them. A proxy sized honestly is small, so
 * the player reads the danger from these rings rather than from a bloated
 * hitbox.
 */
export function contactBands(shoe: ShoeProfile): ContactBands {
  const reach = TARGET_RADIUS * shoe.contactWidth + 0.022;
  return { compression: reach * 0.56, graze: reach * 1.8 };
}

export const geometricContact: ContactResolver = ({ foot, instep, left, right, shoe }) => {
  const reach = TARGET_RADIUS * shoe.contactWidth + 0.022;
  // Measured against the whole striking surface, toe cap to instep, so sliding
  // the pair further along the foot does not read as having slipped it.
  const distance = (t: Vec3): number => distanceToSegment(t, foot, instep, 0.6);
  const dl = distance(left);
  const dr = distance(right);
  const contacted: TargetSide = dl <= dr ? 'left' : 'right';
  const near = Math.min(dl, dr);

  // The bands are anchored to the proxy itself, not to a vague blob around it:
  // inside the proxy is a compression, brushing its surface is a graze, and
  // anything past roughly two proxy widths is a clean miss. That makes a
  // two-centimetre shift the difference between taking it and slipping it.
  if (near > reach * 1.8) return { grade: 'miss', contacted };
  if (dl <= reach * 0.9 && dr <= reach * 0.9) {
    return { grade: 'center-compression', contacted };
  }
  if (near <= reach * 0.56) return { grade: 'single-compression', contacted };
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
  const proxyForward = proxyForwardFor(pose);
  const tiltCos = Math.cos(proxyTiltFor(pose));
  const tiltSin = Math.sin(proxyTiltFor(pose));
  let contactPoint: ContactPoint | null = null;
  /** A won or lost outcome, held until its impact has been reviewed. */
  let pendingResult: GamePhase | null = null;
  /**
   * The lasting shape of what hit each side. Kept here rather than in
   * `TargetState` so the damage model stays a pure function of the grade.
   */
  const imprints: Record<TargetSide, Omit<ProxyImprint, 'depth'> | null> = {
    left: null,
    right: null
  };
  let pelvis: Vec2 = { x: 0, y: 0 };
  let drift: Vec2 = { x: 0, y: 0 };

  let plan: AttackPlan | null = null;
  let phaseTime = 0;
  let accumulator = 0;
  let simTime = 0;
  let lastGrade: ImpactGrade | null = null;
  let footWorld: Vec3 = { ...FOOT_REST_POSITION };
  let instepWorld: Vec3 = { ...FOOT_REST_POSITION };

  /**
   * The pair's world position. The pendulum swings in its own plane, and that
   * plane is laid over with the figure: upright it hangs below the anchor,
   * face down it trails along the ground instead.
   */
  function targetWorld(side: TargetSide): Vec3 {
    const body = side === 'left' ? pair.left : pair.right;
    return {
      x: body.position.x,
      y: pose.anchorHeight + body.position.y * tiltCos,
      z: pelvis.y * DEPTH_TO_Z + proxyForward + body.position.y * tiltSin
    };
  }

  /**
   * Where the pair will be, in the same world axes the contact test uses.
   *
   * The pendulum swings in its own plane and that plane is laid over with the
   * pose, so the offset has to be turned the same way here. Aiming at the raw
   * pendulum height sent every strike at where the pair would have been if it
   * were still standing up, which for a figure lying down is nowhere at all.
   */
  function predictTarget(lookahead: number): Vec3 {
    const cx = (pair.left.position.x + pair.right.position.x) / 2;
    const cy = (pair.left.position.y + pair.right.position.y) / 2;
    const vx = (pair.left.velocity.x + pair.right.velocity.x) / 2;
    const vy = (pair.left.velocity.y + pair.right.velocity.y) / 2;
    const along = cy + vy * lookahead;
    return {
      x: cx + vx * lookahead,
      y: along * tiltCos,
      z: pelvis.y * DEPTH_TO_Z + proxyForward + along * tiltSin
    };
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
        return impactHold(lastGrade, pendingResult !== null);
      case 'recovery':
        return plan.recoveryDuration;
      default:
        return 1;
    }
  }

  /**
   * Trails the instep behind the toe along the direction the foot is
   * travelling, which is what turns a point into a striking surface.
   */
  function updateInstep(currentPlan: AttackPlan): void {
    const [, , approach, end] = currentPlan.path;
    const dx = end.x - approach.x;
    const dy = end.y - approach.y;
    const dz = end.z - approach.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    instepWorld = {
      x: footWorld.x - (dx / length) * STRIKE_SURFACE_LENGTH,
      y: footWorld.y - (dy / length) * STRIKE_SURFACE_LENGTH,
      z: footWorld.z - (dz / length) * STRIKE_SURFACE_LENGTH
    };
  }

  /** The narrowest shoe in the set maps to 0, the broadest to 1. */
  function contactBreadth(): number {
    const span = SHOE_WIDTH_RANGE.max - SHOE_WIDTH_RANGE.min;
    if (span <= 0) return 0.5;
    const t = (shoe.contactWidth - SHOE_WIDTH_RANGE.min) / span;
    return Math.min(1, Math.max(0, t));
  }

  /**
   * Stores which way the shoe pressed into one side, as a unit direction.
   *
   * It is the direction the foot was *travelling*, not the offset from the
   * foot to the target. At the instant of contact those two are in the same
   * place, so the offset is a few millimetres of leftover aim error pointing
   * essentially sideways — which dented the pair edge-on to the camera, where
   * nothing could be seen of it. The travel direction is the one that presses.
   */
  function recordImprint(side: TargetSide, target: Vec3, currentPlan: AttackPlan): void {
    const [, , approach, end] = currentPlan.path;
    const tx = end.x - approach.x;
    const ty = end.y - approach.y;
    const tz = end.z - approach.z;
    const travel = Math.hypot(tx, ty, tz);
    if (travel < 1e-6) return;

    // Where the shoe sat relative to the target leans the dent off-centre, so
    // a contact on the edge is not marked as squarely as one through the middle.
    const ox = target.x - footWorld.x;
    const oy = target.y - footWorld.y;
    const oz = target.z - footWorld.z;
    const offset = Math.hypot(ox, oy, oz);
    const lean = offset > 1e-6 ? OFFSET_LEAN / offset : 0;

    const x = tx / travel + ox * lean;
    const y = ty / travel + oy * lean;
    const z = tz / travel + oz * lean;
    const length = Math.hypot(x, y, z) || 1;

    imprints[side] = {
      x: x / length,
      y: y / length,
      z: z / length,
      width: contactBreadth()
    };
  }

  /** Returns the phase the run settles into after the contact is folded in. */
  function resolveNow(): GamePhase {
    if (!plan) return run.phase;
    const outcome = resolveContact({
      foot: footWorld,
      instep: instepWorld,
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

    // The pair is knocked by what just hit it. Grading is already done above,
    // so this can only affect the attacks that follow.
    const shove = IMPULSE_BY_GRADE[outcome.grade] * power.impulse;
    if (shove > 0) {
      const from = { x: footWorld.x, y: footWorld.y - pose.anchorHeight };
      if (outcome.grade === 'center-compression') {
        pair = applyImpulse(pair, 'left', from, shove);
        pair = applyImpulse(pair, 'right', from, shove);
      } else {
        pair = applyImpulse(pair, outcome.contacted, from, shove);
      }
    }

    lastGrade = outcome.grade;
    // Where the shoe actually met the pair, so the camera can frame the spot
    // rather than the body's midline.
    const struck = targetWorld(outcome.contacted);
    if (outcome.grade !== 'miss') {
      recordImprint(outcome.contacted, struck, plan);
      if (outcome.grade === 'center-compression') {
        const other = outcome.contacted === 'left' ? 'right' : 'left';
        recordImprint(other, targetWorld(other), plan);
      }
    }
    contactPoint =
      outcome.grade === 'miss'
        ? null
        : {
            side: outcome.contacted,
            // Halfway between the shoe and the proxy it met: the spot the
            // player has to see to learn where the dodge went wrong.
            point: {
              x: (struck.x + footWorld.x) / 2,
              y: (struck.y + footWorld.y) / 2,
              z: (struck.z + footWorld.z) / 2
            }
          };
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
        // Every contact is reviewed, including the one that ends the run. The
        // result is held back until that review has played out.
        if (settled === 'won' || settled === 'lost') pendingResult = settled;
        run = { ...run, phase: 'impact' };
        phaseTime = 0;
        break;
      }
      case 'impact':
        run = { ...run, phase: pendingResult ?? 'recovery' };
        pendingResult = null;
        phaseTime = 0;
        lastGrade = null;
        contactPoint = null;
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

    pair = stepPendulum(pair, { x: pelvis.x * PELVIS_RANGE, y: 0 }, dt);

    if (run.phase === 'setup' || run.phase === 'won' || run.phase === 'lost') return;

    phaseTime += dt;

    if (run.phase === 'strike' && plan) {
      footWorld = sampleFootPath(plan, phaseTime / Math.max(dt, plan.strikeDuration));
      updateInstep(plan);
    } else if (run.phase === 'telegraph' && plan) {
      const ease = Math.min(1, phaseTime / Math.max(dt, plan.telegraphDuration));
      footWorld = sampleFootPath(plan, ease * 0.12);
    } else if (run.phase === 'recovery' || run.phase === 'impact') {
      left = recoverTarget(left, dt);
      right = recoverTarget(right, dt);
      if (run.phase === 'impact' && plan) {
        // Carry the shoe through the contact rather than parking it there.
        const drive = Math.min(1, phaseTime / impactHold(lastGrade, pendingResult !== null));
        const end = sampleFootPath(plan, 1);
        footWorld = {
          x: end.x,
          y: end.y,
          z: end.z - followThroughDepth(power.level) * drive
        };
        updateInstep(plan);
      }
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
      core: Math.min(1, Math.max(0, state.permanent)),
      imprint: imprints[side]
        ? { ...imprints[side]!, depth: squashFactor(state) }
        : null,
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
      contact: contactPoint,
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
