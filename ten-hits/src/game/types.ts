/**
 * Shared domain types for TEN HITS.
 *
 * Presentation code only ever receives categorical values from this module.
 * Raw durability numbers stay inside the simulation so the interface can never
 * display a health bar, a percentage, or a hit-point readout.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type PoseId =
  | 'standing-front'
  | 'kneeling-front'
  | 'seated-chair'
  | 'spread-standing'
  | 'crouch-front'
  | 'braced-back';
export type ShoeId = 'pump' | 'stiletto' | 'plateau' | 'strap' | 'platform';
export type ImpactGrade =
  | 'miss'
  | 'graze'
  | 'single-compression'
  | 'center-compression';
export type ColorStage = 0 | 1 | 2 | 3 | 4;
export type TargetSide = 'left' | 'right';

/** Categorical proxy appearance handed to renderer and HUD. */
export type ProxyStage =
  | 'normal'
  | 'initial'
  | 'damaged'
  | 'critical'
  | 'ruptured';

export interface TargetState {
  /** Deformation that recovers between attacks. */
  reversible: number;
  /** Deformation that never recovers. */
  permanent: number;
  /** How strongly the proxy springs back, decays with abuse. */
  elasticity: number;
  /** Accumulated structural stress, gates rupture rolls. */
  fatigue: number;
  /** Resting offset drift, makes the pair asymmetric over a run. */
  bias: number;
  colorStage: ColorStage;
  ruptured: boolean;
}

export interface PoseProfile {
  id: PoseId;
  /** Normalized sideways travel allowance. */
  lateralLimit: number;
  /** Normalized forward/backward travel allowance. */
  depthLimit: number;
  /** Normalized torso rotation allowance. */
  rotationLimit: number;
  /** Scales how long an attack telegraphs before it lands. */
  telegraphMultiplier: number;
  /** Height of the target anchor in world units. */
  anchorHeight: number;
  /**
   * How far in front of the body's origin the pair hangs, in world metres.
   * Upright poses hang it forward of the pelvis; a face-down figure hangs it
   * back between the thighs instead, so this is per pose rather than fixed.
   */
  proxyForward?: number;
  /**
   * Where the cords root, in the same world metres as `proxyForward`.
   *
   * The pubic attachment does not move with the pair. Face down it stays
   * against the belly while only the cords and the pair come back out between
   * the thighs, so the two are metres apart and the cords run at an angle.
   * Defaults to the pair's own offset, which is the upright case: straight
   * down from the attachment.
   */
  tetherForward?: number;
}

export interface ShoeProfile {
  id: ShoeId;
  /** Contact footprint: wide shoes graze more easily. */
  contactWidth: number;
  /** Force concentration at the contact point. */
  localPressure: number;
  mass: number;
  /** How quickly the attacker can pull the foot back. */
  recovery: number;
}

export interface PowerProfile {
  level: number;
  speed: number;
  impulse: number;
}

export interface PendulumBody {
  position: Vec2;
  velocity: Vec2;
  restOffset: Vec2;
}

export interface PendulumPair {
  left: PendulumBody;
  right: PendulumBody;
}

export type GamePhase =
  | 'setup'
  | 'telegraph'
  | 'strike'
  | 'impact'
  | 'recovery'
  | 'won'
  | 'lost';

export type AttackKind =
  | 'straight'
  | 'diagonal-left'
  | 'diagonal-right'
  | 'feint';

export interface AttackPlan {
  kind: AttackKind;
  /** Bezier control points in world space for the attacking foot. */
  path: [Vec3, Vec3, Vec3, Vec3];
  /** How tightly the attack tracks the predicted target position, 0..1. */
  precision: number;
  telegraphDuration: number;
  strikeDuration: number;
  recoveryDuration: number;
  /** Side the attack is biased toward. */
  favoredSide: TargetSide;
}

export interface AttackContext {
  validHits: number;
  anger: number;
  seed: number;
  pose: PoseProfile;
  shoe: ShoeProfile;
  power: PowerProfile;
  /** Where the pair is expected to be when the shoe arrives, in world metres. */
  predictedTarget: Vec3;
  recentPlayerDrift: Vec2;
  leftDamage: number;
  rightDamage: number;
}

export interface RunState {
  phase: GamePhase;
  validHits: number;
  anger: number;
  extraAttackQueued: boolean;
  attackIndex: number;
  seed: number;
  missCount: number;
}

/** Non-numeric per-side description consumed by renderer and HUD. */
export interface ProxySnapshot {
  side: TargetSide;
  stage: ProxyStage;
  colorStage: ColorStage;
  /** 0..1 squash factor for the proxy shape, purely visual. */
  squash: number;
  /** 0..1 crack overlay strength, purely visual. */
  cracking: number;
  /**
   * 0..1 permanent crushing of the inner core. Unlike `squash` this never
   * recovers, so it is what a run leaves behind.
   */
  core: number;
  /** Null until something has actually landed on this side. */
  imprint: ProxyImprint | null;
  position: Vec2;
}

export type AngerMood = 'calm' | 'annoyed' | 'irritated' | 'furious' | 'seething';
export type CameraPhase = 'free-orbit' | 'recentering' | 'locked';
export type RunResult = 'in-progress' | 'survived' | 'ruptured';

/**
 * The dent the shoe left: which way it came from, how wide the contact patch
 * was, and how deep it currently sits. A stiletto leaves a narrow deep mark and
 * a platform a broad shallow one, which is what makes the footwear choice
 * visible on the proxy rather than only in the numbers behind it.
 */
export interface ProxyImprint {
  /** Unit direction the shoe pressed along, in the proxy's own axes. */
  x: number;
  y: number;
  z: number;
  /** 0 for the narrowest shoe in the set, 1 for the broadest. */
  width: number;
  /** 0..1, deepest at contact and settling to what never recovers. */
  depth: number;
}

/** Where the shoe met the pair on the last scored contact, in world metres. */
export interface ContactPoint {
  side: TargetSide;
  point: Vec3;
}

export interface GameSnapshot {
  phase: GamePhase;
  /** Exactly ten booleans, one per required valid contact. */
  hitDots: boolean[];
  angerMood: AngerMood;
  cameraPhase: CameraPhase;
  result: RunResult;
  proxies: [ProxySnapshot, ProxySnapshot];
  anchor: Vec2;
  foot: Vec3;
  attackKind: AttackKind | null;
  /** 0..1 progress through the current phase, for animation blending. */
  phaseProgress: number;
  /** Set for one snapshot right after a contact resolves. */
  lastGrade: ImpactGrade | null;
  /** Null on a miss and outside the impact phase. */
  contact: ContactPoint | null;
  pose: PoseId;
  shoe: ShoeId;
  power: number;
}
