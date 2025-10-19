// Spark-based explosion utilities (no rings), functional and class-free.
//
// Usage sketch:
// - Keep an array of explosions in your game state: Explosion[]
// - When something explodes, push ...spawnSparkBurst(x, y, { magnitude, durationMs })
// - Each physics tick: explosions = tickExplosions(explosions, dt, worldW, worldH)
// - Each frame: drawExplosions(ctx, explosions, viewport.v)
//
// Notes:
// - "magnitude" is in world units and scales spark count and length.
// - "durationMs" controls how long sparks live; defaults are provided.
// - No sounds are played here; trigger sounds in your game logic alongside spawning.
//
import { wrapWithMargin } from './util';

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type Spark = {
  readonly kind: 'spark';
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly angle: number; // current orientation (radians)
  readonly spin: number; // angular velocity (radians/ms)
  readonly length: number; // world units
  readonly lifeMs: number; // remaining life
  readonly maxLifeMs: number; // original total life
  readonly easing: Easing; // fade easing for alpha over life
  readonly color?: string; // optional CSS color for this spark
};

export type Explosion = Spark;

export type Easing = 'linear' | 'easeOutQuad';

export type SparkBurstOptions = {
  // Size/strength in world units; affects spark count and length
  readonly magnitude: number;

  // Total lifetime per spark; slight randomness will be added
  readonly durationMs?: number;

  // Optional explicit particle count; when omitted, derived from magnitude
  readonly count?: number;

  // Speed range in world units per ms
  readonly speedRange?: readonly [number, number];

  // Spark line length range in world units
  readonly lengthRange?: readonly [number, number];

  // Angular velocity range (radians/ms)
  readonly spinRange?: readonly [number, number];

  // Easing controls alpha fade over lifetime
  readonly easing?: Easing;

  // Optional color for the sparks (CSS color). If omitted, defaults to white when drawing.
  readonly color?: string;
};

// easing is part of Spark; InternalSpark removed

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function randInRange(min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.random() * (hi - lo);
}

function pickCountFromMagnitude(magnitude: number): number {
  // Roughly 6 sparks per unit, clamped
  return Math.max(8, Math.min(64, Math.floor(magnitude * 6)));
}

function defaultedOptions(
  options: SparkBurstOptions,
): Required<Omit<SparkBurstOptions, 'magnitude' | 'color'>> & { color?: string } {
  const durationMs = options.durationMs ?? 450;
  const count = options.count ?? pickCountFromMagnitude(options.magnitude);
  const speedRange = options.speedRange ?? ([0.01, 0.04] as const);
  const lengthRange = options.lengthRange ?? ([0.4, 1.6] as const);
  const spinRange = options.spinRange ?? ([-0.004, 0.004] as const);
  const easing = options.easing ?? 'easeOutQuad';
  const color = options.color;
  return { durationMs, count, speedRange, lengthRange, spinRange, easing, color };
}

function makeSpark(
  x: number,
  y: number,
  durationMs: number,
  speedRange: readonly [number, number],
  lengthRange: readonly [number, number],
  spinRange: readonly [number, number],
  easing: Easing,
  color: string | undefined,
): Spark {
  const angle = Math.random() * Math.PI * 2;
  const speed = randInRange(speedRange[0], speedRange[1]); // world units per ms
  const length = randInRange(lengthRange[0], lengthRange[1]);
  const spin = randInRange(spinRange[0], spinRange[1]);
  // add subtle lifetime variation per spark
  const maxLifeMs = durationMs * randInRange(0.9, 1.1);

  return {
    kind: 'spark',
    x,
    y,
    dx: Math.cos(angle) * speed,
    dy: Math.sin(angle) * speed,
    angle,
    spin,
    length,
    lifeMs: maxLifeMs,
    maxLifeMs,
    easing,
    color,
  };
}

export function spawnSparkBurst(x: number, y: number, options: SparkBurstOptions): Explosion[] {
  const { durationMs, count, speedRange, lengthRange, spinRange, easing, color } = defaultedOptions(options);
  const sparks: Spark[] = [];
  for (let i = 0; i < count; i++) {
    sparks.push(makeSpark(x, y, durationMs, speedRange, lengthRange, spinRange, easing, color));
  }
  return sparks;
}

export function tickExplosions(
  explosions: readonly Explosion[],
  dt: number,
  worldWidthUnits: number,
  worldHeightUnits: number,
): Explosion[] {
  const next: Spark[] = [];
  for (const e of explosions) {
    // All current explosion types are sparks
    const lifeMs = e.lifeMs - dt;
    if (lifeMs <= 0) continue;
    // Wrap world coordinates like other entities
    const margin = 0;
    const x = wrapWithMargin(e.x + e.dx * dt, worldWidthUnits, margin);
    const y = wrapWithMargin(e.y + e.dy * dt, worldHeightUnits, margin);
    const angle = e.angle + e.spin * dt;
    next.push({ ...e, x, y, angle, lifeMs });
  }
  return next;
}

function applyEasing(t: number, easing: Easing): number {
  // t in [0,1] where 1 is fresh, 0 is expired
  if (easing === 'linear') return t;
  // easeOutQuad
  return 1 - (1 - t) * (1 - t);
}

export function drawExplosions(ctx: Ctx, explosions: readonly Explosion[], v: number): void {
  for (const e of explosions) {
    const tRaw = e.lifeMs / e.maxLifeMs;
    const t = clamp(tRaw, 0, 1);
    const alpha = applyEasing(t, e.easing);
    const halfLenPx = (e.length * v) / 2;
    const dx = Math.cos(e.angle) * halfLenPx;
    const dy = Math.sin(e.angle) * halfLenPx;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = e.color ?? 'white';
    ctx.beginPath();
    ctx.moveTo(e.x * v - dx, e.y * v - dy);
    ctx.lineTo(e.x * v + dx, e.y * v + dy);
    ctx.stroke();
    ctx.restore();
  }
}
