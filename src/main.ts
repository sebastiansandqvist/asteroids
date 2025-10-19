import { Button, gamepads, HapticIntensity } from '@spud.gg/api';
import { makeAsteroidGeometry, makeShipGeometry } from './shapes';
import { lerp, randomBetween, randomIntInRange, wrapDelta, wrapWithMargin } from './util';
import { GameMode, Size, state, type State, Color, ShipSize } from './state';
import { sounds } from './audio';
import { spawnSparkBurst, tickExplosions, drawExplosions } from './explosions';

function computeViewport(rect: DOMRect) {
  const vw = rect.width / 100;
  const vh = rect.height / 100;
  const v = Math.min(vw, vh);
  const worldWidthUnits = rect.width / v;
  const worldHeightUnits = rect.height / v;
  return { vw, vh, v, worldWidthUnits, worldHeightUnits, rect };
}

const isShooting = () =>
  gamepads.singlePlayer.isButtonDown(Button.South) || gamepads.singlePlayer.isButtonDown(Button.RightTrigger);

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

type Asteroid = State['asteroids'][number];
type Ship = State['ship'];
type Bullet = State['ship']['bullets'][number];

const maxActiveBullets = 10;
const explosionDurationMsAsteroid = 400;
const explosionDurationMsShip = 600;

type Viewport = ReturnType<typeof computeViewport>;

// Multiplayer types inferred from state
type Player = State['players'][number];
type MpShip = Player['ships'][number];
type MpBullet = Player['bullets'][number];

// Geometry helpers (world-space)
function transformPoints(
  points: ReadonlyArray<readonly [number, number]>,
  angle: number,
  tx: number,
  ty: number,
): ReadonlyArray<readonly [number, number]> {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return points.map(([x, y]) => [tx + (x * c - y * s), ty + (x * s + y * c)] as const);
}

function pointInPolygon(p: readonly [number, number], poly: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    const intersect = yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Versus: initialize two players
function startVersus(state: State, worldWidthUnits: number, worldHeightUnits: number): void {
  state.mode = GameMode.Versus;
  state.level = 1;
  state.levelTransitionMs = 0;
  state.screenShakeAmount = 0;
  state.players = [
    {
      color: Color.Blue,
      score: 0,
      angle: -Math.PI / 2,
      isBoosting: false,
      fireCooldownMs: 0,
      ships: [
        {
          x: worldWidthUnits * 0.25,
          y: worldHeightUnits * 0.5,
          dx: 0,
          dy: 0,
          size: ShipSize.Large,
          invincibleMs: 1200,
        },
      ],
      bullets: [],
    },
    {
      color: Color.Red,
      score: 0,
      angle: -Math.PI / 2,
      isBoosting: false,
      fireCooldownMs: 0,
      ships: [
        {
          x: worldWidthUnits * 0.75,
          y: worldHeightUnits * 0.5,
          dx: 0,
          dy: 0,
          size: ShipSize.Large,
          invincibleMs: 1200,
        },
      ],
      bullets: [],
    },
  ];
}

// Versus game loop
function updateVersus(state: State, dt: number, worldWidthUnits: number, worldHeightUnits: number): void {
  // Move asteroids
  state.asteroids.forEach((asteroid) => {
    asteroid.x += asteroid.dx * dt;
    asteroid.y += asteroid.dy * dt;
    asteroid.angle += asteroid.dangle * dt;
    asteroid.x = wrapWithMargin(asteroid.x, worldWidthUnits, asteroid.size);
    asteroid.y = wrapWithMargin(asteroid.y, worldHeightUnits, asteroid.size);
  });

  // Explosions + camera
  state.explosions = tickExplosions(state.explosions, dt, worldWidthUnits, worldHeightUnits);
  easeCameraToZero(state, dt);

  // Input helpers
  const padIsShooting = (p: typeof gamepads.p1) => p.isButtonDown(Button.South) || p.isButtonDown(Button.RightTrigger);

  // Physics + input per player (match SP feel)
  state.players.forEach((player) => {
    const pad = player.color === Color.Blue ? gamepads.p1 : gamepads.p2;

    // Boosting + angle like SP
    player.isBoosting = pad.leftStick.magnitude > 0.75;
    if (player.isBoosting) {
      player.angle = pad.leftStick.angle;
    }

    // Fire (hold-to-fire) with per-player cooldown
    player.fireCooldownMs = Math.max(0, player.fireCooldownMs - dt);
    if (player.ships.length > 0 && player.fireCooldownMs <= 0 && padIsShooting(pad)) {
      const bulletSpeed = (Math.min(worldWidthUnits, worldHeightUnits) * 1.5) / 1000;
      const dirx = Math.cos(player.angle);
      const diry = Math.sin(player.angle);
      for (const s of player.ships) {
        player.bullets.push({
          x: s.x + dirx * s.size,
          y: s.y + diry * s.size,
          dx: dirx * bulletSpeed + s.dx / dt,
          dy: diry * bulletSpeed + s.dy / dt,
          ttlMs: 500,
          color: player.color,
        });
      }
      player.fireCooldownMs = 200;
      sounds('shoot').play({ volume: 5 });
      pad.rumble(1, HapticIntensity.Light);
    }

    // Movement (match SP accel constant)
    if (player.isBoosting) {
      const accel = 0.0005 * pad.leftStick.magnitude * dt;
      const ax = Math.cos(player.angle) * accel;
      const ay = Math.sin(player.angle) * accel;
      for (const s of player.ships) {
        s.dx += ax;
        s.dy += ay;
      }
    }

    // Integrate + wrap + invincibility
    for (const s of player.ships) {
      s.x = wrapWithMargin(s.x + s.dx, worldWidthUnits, s.size / 2);
      s.y = wrapWithMargin(s.y + s.dy, worldHeightUnits, s.size / 2);
      if (s.invincibleMs > 0) s.invincibleMs = Math.max(0, s.invincibleMs - dt);
    }

    // Bullets update
    player.bullets = player.bullets
      .map((b) => ({
        ...b,
        x: wrapWithMargin(b.x + b.dx * dt, worldWidthUnits, 0),
        y: wrapWithMargin(b.y + b.dy * dt, worldHeightUnits, 0),
        ttlMs: b.ttlMs - dt,
      }))
      .filter((b) => b.ttlMs > 0);
  });

  // Shared constants (mirror SP)
  const explosionTtlMs = 0;
  const childSpeedMin = 0.01;
  const childSpeedMax = 0.03;
  const spawnJitter = 0.25;
  const childDangleMax = 0.005;
  const bulletRadiusWorld = 0.5;

  const scoreForAsteroid = (s: number) => (s === Size.Big ? 20 : s === Size.Med ? 50 : 100);
  const scoreForShip = (sz: number) => (sz === ShipSize.Large ? 40 : sz === ShipSize.Med ? 100 : 200);

  const bulletHitsAsteroidRadius = (b: { x: number; y: number }, a: Asteroid) => {
    const dx = wrapDelta(b.x - a.x, worldWidthUnits);
    const dy = wrapDelta(b.y - a.y, worldHeightUnits);
    const r = a.size + bulletRadiusWorld;
    return dx * dx + dy * dy <= r * r;
  };

  const splitAsteroidLocal = (asteroid: Asteroid): Asteroid[] => {
    const childSize = asteroid.size === Size.Big ? Size.Med : asteroid.size === Size.Med ? Size.Small : 0;
    if (childSize === 0) return [];
    return [true, true].map(() => {
      const direction = Math.random() * Math.PI * 2;
      const speed = childSpeedMin + Math.random() * (childSpeedMax - childSpeedMin);
      const jitterX = (Math.random() * 2 - 1) * spawnJitter;
      const jitterY = (Math.random() * 2 - 1) * spawnJitter;
      return {
        x: wrapWithMargin(asteroid.x + jitterX, worldWidthUnits, childSize),
        y: wrapWithMargin(asteroid.y + jitterY, worldHeightUnits, childSize),
        dx: Math.cos(direction) * speed,
        dy: Math.sin(direction) * speed,
        angle: Math.random() * Math.PI * 2,
        dangle: (Math.random() * 2 - 1) * childDangleMax,
        variant: randomIntInRange(0, 2),
        size: childSize,
      };
    });
  };

  // Bullet–asteroid collisions (with splitting like SP)
  const asteroidsToRemove = new Set<number>();
  const childrenToAdd: Asteroid[] = [];
  state.players.forEach((p) => {
    const survivors: MpBullet[] = [];
    p.bullets.forEach((b) => {
      let hitIdx: number | null = null;
      for (let i = 0; i < state.asteroids.length; i++) {
        const a = state.asteroids[i]!;
        if (a.timeUntilDead !== undefined) continue;
        if (bulletHitsAsteroidRadius(b, a)) {
          hitIdx = i;
          break;
        }
      }
      if (hitIdx !== null) {
        const a = state.asteroids[hitIdx]!;
        p.score += scoreForAsteroid(a.size);
        p.color === Color.Blue
          ? gamepads.p1.rumble(50, HapticIntensity.Heavy)
          : gamepads.p2.rumble(50, HapticIntensity.Heavy);
        const burst = spawnSparkBurst(a.x, a.y, { magnitude: a.size, durationMs: explosionDurationMsAsteroid });
        state.explosions = state.explosions.concat(burst);
        const soundSpeed = { [Size.Big]: 1, [Size.Med]: 2, [Size.Small]: 3 }[a.size] ?? 1;
        sounds('explode').play({ volume: 1 / soundSpeed, speed: soundSpeed });
        state.screenShakeAmount = 1 / (20 - a.size * 2);
        if (a.size === Size.Big || a.size === Size.Med) {
          asteroidsToRemove.add(hitIdx);
          const kids = splitAsteroidLocal(a);
          for (const k of kids) childrenToAdd.push(k);
        } else {
          a.timeUntilDead = explosionTtlMs;
        }
      } else {
        survivors.push(b);
      }
    });
    p.bullets = survivors;
  });

  // Rebuild asteroids and cull expired
  state.asteroids = state.asteroids
    .filter((a, i) => a.timeUntilDead !== undefined || !asteroidsToRemove.has(i))
    .concat(childrenToAdd)
    .filter((a) => a.timeUntilDead === undefined || a.timeUntilDead > 0);

  // Ship splitting helper (non-overlapping)
  function splitShipFragment(player: Player, index: number): void {
    const s = player.ships[index]!;
    const next = s.size === ShipSize.Large ? ShipSize.Med : s.size === ShipSize.Med ? ShipSize.Small : null;
    if (next === null) {
      player.ships.splice(index, 1);
      return;
    }
    const attempts = 24;
    const radius = (size: number) => size;
    const minR = radius(next) * 2;
    const maxR = minR * 2;

    const base = s;
    const tryPlace = (existing: ReadonlyArray<MpShip>): MpShip | null => {
      for (let i = 0; i < attempts; i++) {
        const r = minR + Math.random() * (maxR - minR);
        const theta = Math.random() * Math.PI * 2;
        const x = base.x + Math.cos(theta) * r;
        const y = base.y + Math.sin(theta) * r;
        const overlaps = existing.some((e) => {
          const dx = x - e.x;
          const dy = y - e.y;
          const rr = radius(next) + radius(e.size);
          return dx * dx + dy * dy < rr * rr;
        });
        if (!overlaps) return { x, y, dx: base.dx, dy: base.dy, size: next, invincibleMs: 500 };
      }
      return null;
    };

    const pool = player.ships.slice(0, index).concat(player.ships.slice(index + 1));
    const a = tryPlace(pool);
    if (a) {
      const b = tryPlace(pool.concat([a]));
      if (b) {
        player.ships.splice(index, 1, a, b);
        return;
      }
    }
    player.ships.splice(index, 1);
  }

  // Bullets vs ships (point-in-polygon), friendly fire by different player only
  state.players.forEach((attacker, ai) => {
    const others = state.players.filter((_, i) => i !== ai);
    const survivors: MpBullet[] = [];
    attacker.bullets.forEach((b) => {
      let hit = false;
      for (const defender of others) {
        for (let si = 0; si < defender.ships.length; si++) {
          const s = defender.ships[si]!;
          if (s.invincibleMs > 0) continue;
          const { verts } = makeShipGeometry(s.size);
          const poly = transformPoints(verts, defender.angle, s.x, s.y);
          if (pointInPolygon([b.x, b.y], poly)) {
            attacker.score += scoreForShip(s.size);
            const burst = spawnSparkBurst(s.x, s.y, { magnitude: s.size * 2.5, durationMs: explosionDurationMsShip });
            state.explosions = state.explosions.concat(burst);
            sounds('kaboom').play({ volume: 0.5 });
            sounds('kaboomBass').play({ volume: 1 });
            state.screenShakeAmount = 1;
            splitShipFragment(defender, si);
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
      if (!hit) survivors.push(b);
    });
    attacker.bullets = survivors;
  });

  // Asteroids vs ships
  state.players.forEach((p) => {
    for (let si = 0; si < p.ships.length; si++) {
      const s = p.ships[si]!;
      if (s.invincibleMs > 0) continue;
      for (const a of state.asteroids) {
        const dx = wrapDelta(s.x - a.x, worldWidthUnits);
        const dy = wrapDelta(s.y - a.y, worldHeightUnits);
        const r = a.size + s.size;
        if (dx * dx + dy * dy <= r * r) {
          const burst = spawnSparkBurst(s.x, s.y, { magnitude: s.size * 2.5, durationMs: explosionDurationMsShip });
          state.explosions = state.explosions.concat(burst);
          sounds('kaboom').play({ volume: 0.5 });
          sounds('kaboomBass').play({ volume: 1 });
          state.screenShakeAmount = 1;
          splitShipFragment(p, si);
          si--;
          break;
        }
      }
    }
  });

  // End condition -> back to Menu (overlay will show both scores)
  const alivePlayers = state.players.filter((p) => p.ships.length > 0).length;
  if (alivePlayers <= 1) {
    state.mode = GameMode.Menu;
  }
}

// Versus rendering
function drawPlayersAndBullets(ctx: Ctx, viewport: Viewport) {
  const v = viewport.v;
  ctx.save();
  for (const p of state.players) {
    ctx.save();
    ctx.strokeStyle = p.color;
    ctx.fillStyle = p.color;

    // ships (with flicker on invincible)
    for (const s of p.ships) {
      if (s.invincibleMs > 0 && Math.floor(s.invincibleMs / 100) % 2 === 0) continue;
      const { segs } = makeShipGeometry(s.size * v, p.isBoosting);
      drawShape(ctx, segs as unknown as readonly Segment[], s.x * v, s.y * v, p.angle);
    }

    // bullets
    const radius = Math.max(1, ctx.lineWidth);
    for (const b of p.bullets) {
      ctx.beginPath();
      ctx.ellipse(b.x * v, b.y * v, radius, radius, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

function randomAsteroidOutsideCenter(
  size: number,
  worldWidthUnits: number,
  worldHeightUnits: number,
  exclusionRadius: number,
): Asteroid {
  const centerX = worldWidthUnits / 2;
  const centerY = worldHeightUnits / 2;
  const maxTries = 50;

  for (let i = 0; i < maxTries; i++) {
    const x = Math.random() * worldWidthUnits;
    const y = Math.random() * worldHeightUnits;
    const dx = x - centerX;
    const dy = y - centerY;
    if (dx * dx + dy * dy <= (exclusionRadius + size) * (exclusionRadius + size)) continue;

    return {
      x,
      y,
      dx: randomBetween(-0.02, 0.02),
      dy: randomBetween(-0.02, 0.02),
      angle: randomBetween(0, Math.PI * 2),
      dangle: randomBetween(-0.005, 0.005),
      variant: randomIntInRange(0, 2),
      size,
    };
  }

  // Fallback: place at edge of exclusion radius if random tries all failed
  const dir = Math.random() * Math.PI * 2;
  const rx = centerX + Math.cos(dir) * (exclusionRadius + size * 2);
  const ry = centerY + Math.sin(dir) * (exclusionRadius + size * 2);
  return {
    x: wrapWithMargin(rx, worldWidthUnits, size),
    y: wrapWithMargin(ry, worldHeightUnits, size),
    dx: randomBetween(-0.02, 0.02),
    dy: randomBetween(-0.02, 0.02),
    angle: 0,
    dangle: randomBetween(-0.003, 0.003),
    variant: randomIntInRange(0, 2),
    size,
  };
}

function seedLevel(state: State, level: number, worldWidthUnits: number, worldHeightUnits: number): void {
  const baseSizes =
    state.baseAsteroidSizes.length > 0
      ? state.baseAsteroidSizes
      : (state.asteroids.map((a) => a.size) as readonly number[]);
  const exclusion = state.ship.size * 8;

  const baseAsteroids = baseSizes.map((s) =>
    randomAsteroidOutsideCenter(s, worldWidthUnits, worldHeightUnits, exclusion),
  );

  const extraBigCount = Math.max(0, (level - 1) * 2);
  const extras = Array.from({ length: extraBigCount }, () =>
    randomAsteroidOutsideCenter(Size.Big, worldWidthUnits, worldHeightUnits, exclusion),
  );

  state.asteroids = baseAsteroids.concat(extras);
}

function startNewGame(state: State, worldWidthUnits: number, worldHeightUnits: number): void {
  state.mode = GameMode.Playing;
  state.level = 1;

  state.ship.score = 0;
  state.ship.lives = 5;
  state.ship.x = worldWidthUnits / 2;
  state.ship.y = worldHeightUnits / 2;
  state.ship.dx = 0;
  state.ship.dy = 0;
  state.ship.angle = -Math.PI / 2;
  state.ship.isBoosting = false;
  state.ship.fireCooldownMs = 200; // avoid accidental shot if A is held
  state.ship.invincibleMs = 1500;
  state.ship.respawnMs = 0;
  state.ship.bullets = [];

  seedLevel(state, state.level, worldWidthUnits, worldHeightUnits);
}

function nextLevel(state: State, worldWidthUnits: number, worldHeightUnits: number): void {
  state.level += 1;
  seedLevel(state, state.level, worldWidthUnits, worldHeightUnits);

  // brief grace period, reset to center
  state.ship.x = worldWidthUnits / 2;
  state.ship.y = worldHeightUnits / 2;
  state.ship.dx = 0;
  state.ship.dy = 0;
  state.ship.invincibleMs = 1500;
  state.ship.respawnMs = 0;
}

function drawMenuOrGameOverOverlay(state: State, ctx: Ctx, viewport: Viewport) {
  const { v, rect } = viewport;
  const cx = rect.width / 2;
  const cy = rect.height / 2;

  const isGameOver = state.ship.lives === 0;
  const scoreLine = `Score ${state.ship.score}`;
  const actionLabel =
    gamepads.playerCount === 0
      ? 'Connect a gamepad'
      : isGameOver
        ? 'Replay (A)'
        : gamepads.playerCount >= 2
          ? 'VERSUS (A)'
          : 'Start (A)';

  ctx.save();

  // text metrics first (all overlay text uses the score size)
  ctx.font = `${8 * v}px Hyperspace`;
  const hasBothPlayers = state.players.length >= 2;
  const lines = hasBothPlayers
    ? ([`Blue ${state.players[0]?.score ?? 0}`, `Red ${state.players[1]?.score ?? 0}`, actionLabel] as const)
    : isGameOver
      ? [scoreLine, actionLabel]
      : [actionLabel];

  // compute per-line metrics and overall block dimensions
  const measures = lines.map((t) => ctx.measureText(t));
  const widths = measures.map((m) => m.width);
  const ascent = measures.reduce((a, m) => Math.max(a, m.actualBoundingBoxAscent ?? 0), 0);
  const descent = measures.reduce((a, m) => Math.max(a, m.actualBoundingBoxDescent ?? 0), 0);
  const lineBox = ascent + descent;
  const gap = 2 * v;

  const textBlockHeight = lineBox * lines.length + (lines.length > 1 ? gap * (lines.length - 1) : 0);
  const maxWidth = widths.reduce((a, b) => Math.max(a, b), 0);
  const paddingX = 6 * v;
  const paddingY = 4 * v;

  // dynamic box sized to content, centered on screen
  const boxW = Math.min(rect.width * 0.9, maxWidth + paddingX * 2);
  const boxH = paddingY * 2 + textBlockHeight;
  const x = cx - boxW / 2;
  const y = cy - boxH / 2;

  // panel
  ctx.fillStyle = 'white';
  ctx.fillRect(x, y, boxW, boxH);

  // text
  ctx.fillStyle = 'black';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // center the text block within the box using real font metrics
  let baselineY = y + (boxH - textBlockHeight) / 2 + ascent;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, cx, baselineY);
    baselineY += lineBox + (i < lines.length - 1 ? gap : 0);
  }

  ctx.restore();
}

function update(state: State, dt: number, worldWidthUnits: number, worldHeightUnits: number) {
  // Versus mode update
  if ((state.mode as GameMode) === GameMode.Versus) {
    updateVersus(state, dt, worldWidthUnits, worldHeightUnits);
    gamepads.clearInputs();
    return;
  }
  // Menu mode: update background asteroids/explosions and wait for Start/Replay (A)
  if (state.mode !== GameMode.Playing) {
    state.asteroids.forEach((asteroid) => {
      asteroid.x += asteroid.dx * dt;
      asteroid.y += asteroid.dy * dt;
      asteroid.angle += asteroid.dangle * dt;
      asteroid.x = wrapWithMargin(asteroid.x, worldWidthUnits, asteroid.size);
      asteroid.y = wrapWithMargin(asteroid.y, worldHeightUnits, asteroid.size);
    });

    state.explosions = tickExplosions(state.explosions, dt, worldWidthUnits, worldHeightUnits);
    easeCameraToZero(state, dt);

    if (gamepads.playerCount >= 2 && gamepads.anyPlayer.buttonJustPressed(Button.South)) {
      startVersus(state, worldWidthUnits, worldHeightUnits);
    } else if (gamepads.playerCount > 0 && gamepads.singlePlayer.buttonJustPressed(Button.South)) {
      startNewGame(state, worldWidthUnits, worldHeightUnits);
    }

    gamepads.clearInputs();
    return;
  }

  // Level transition blackout: pause gameplay updates until next wave spawns
  if (state.levelTransitionMs > 0) {
    state.levelTransitionMs = Math.max(0, state.levelTransitionMs - dt);
    if (state.levelTransitionMs === 0) {
      nextLevel(state, worldWidthUnits, worldHeightUnits);
    }
    gamepads.clearInputs();
    return;
  }

  if (state.ship.respawnMs <= 0) {
    state.ship.x += state.ship.dx;
    state.ship.y += state.ship.dy;
    state.ship.x = wrapWithMargin(state.ship.x, worldWidthUnits, state.ship.size / 2);
    state.ship.y = wrapWithMargin(state.ship.y, worldHeightUnits, state.ship.size / 2);

    state.ship.isBoosting = gamepads.singlePlayer.leftStick.magnitude > 0.75;
    if (state.ship.isBoosting) {
      state.ship.angle = gamepads.singlePlayer.leftStick.angle;
      state.ship.dx += Math.cos(state.ship.angle) * gamepads.singlePlayer.leftStick.magnitude * 0.0005 * dt;
      state.ship.dy += Math.sin(state.ship.angle) * gamepads.singlePlayer.leftStick.magnitude * 0.0005 * dt;
    }
  } else {
    // while respawning, ignore movement inputs
    state.ship.isBoosting = false;
  }

  {
    state.ship.fireCooldownMs = Math.max(0, state.ship.fireCooldownMs - dt);

    if (state.ship.respawnMs <= 0 && state.ship.fireCooldownMs <= 0 && isShooting()) {
      state.ship.fireCooldownMs = 200;
      const bulletSpeed = (Math.min(worldWidthUnits, worldHeightUnits) * 1.5) / 1000; // half the playfield width per second
      state.ship.bullets.push({
        x: state.ship.x + Math.cos(state.ship.angle) * state.ship.size,
        y: state.ship.y + Math.sin(state.ship.angle) * state.ship.size,
        dx: Math.cos(state.ship.angle) * bulletSpeed + state.ship.dx / dt,
        dy: Math.sin(state.ship.angle) * bulletSpeed + state.ship.dy / dt,
        ttlMs: 500,
      });

      if (state.ship.bullets.length > maxActiveBullets) {
        state.ship.bullets[0]!.ttlMs = 0;
      }

      sounds('shoot').play({ volume: 5 });
      gamepads.singlePlayer.rumble(1, HapticIntensity.Light);
    }
  }

  state.ship.bullets.forEach((bullet) => {
    bullet.x += bullet.dx * dt;
    bullet.y += bullet.dy * dt;
    bullet.ttlMs -= dt;
    bullet.x = wrapWithMargin(bullet.x, worldWidthUnits, 0);
    bullet.y = wrapWithMargin(bullet.y, worldHeightUnits, 0);
  });
  state.ship.bullets = state.ship.bullets.filter((b) => b.ttlMs > 0);

  state.asteroids.forEach((asteroid) => {
    asteroid.x += asteroid.dx * dt;
    asteroid.y += asteroid.dy * dt;
    asteroid.angle += asteroid.dangle * dt;
    asteroid.x = wrapWithMargin(asteroid.x, worldWidthUnits, asteroid.size);
    asteroid.y = wrapWithMargin(asteroid.y, worldHeightUnits, asteroid.size);
  });

  const explosionTtlMs = 0;
  // const explosionTtlMs = 300;
  const childSpeedMin = 0.01;
  const childSpeedMax = 0.03;
  const spawnJitter = 0.25;
  const childDangleMax = 0.005;
  const bulletRadiusWorld = 0.5;

  function bulletHitsAsteroidRadius(bullet: Bullet, asteroid: Asteroid): boolean {
    const dx = wrapDelta(bullet.x - asteroid.x, worldWidthUnits);
    const dy = wrapDelta(bullet.y - asteroid.y, worldHeightUnits);
    const radiusSum = asteroid.size + bulletRadiusWorld;
    return dx * dx + dy * dy <= radiusSum * radiusSum;
  }

  function pointHitsAsteroidRadius(px: number, py: number, asteroid: Asteroid): boolean {
    const dx = wrapDelta(px - asteroid.x, worldWidthUnits);
    const dy = wrapDelta(py - asteroid.y, worldHeightUnits);
    const r = asteroid.size;
    return dx * dx + dy * dy <= r * r;
  }

  function splitAsteroid(asteroid: Asteroid): Asteroid[] {
    const childSize = asteroid.size === Size.Big ? Size.Med : asteroid.size === Size.Med ? Size.Small : 0;
    if (childSize === 0) return [];
    return [true, true].map(() => {
      const direction = Math.random() * Math.PI * 2;
      const speed = childSpeedMin + Math.random() * (childSpeedMax - childSpeedMin);
      const jitterX = (Math.random() * 2 - 1) * spawnJitter;
      const jitterY = (Math.random() * 2 - 1) * spawnJitter;
      return {
        x: wrapWithMargin(asteroid.x + jitterX, worldWidthUnits, childSize),
        y: wrapWithMargin(asteroid.y + jitterY, worldHeightUnits, childSize),
        dx: Math.cos(direction) * speed,
        dy: Math.sin(direction) * speed,
        angle: Math.random() * Math.PI * 2,
        dangle: (Math.random() * 2 - 1) * childDangleMax,
        variant: randomIntInRange(0, 2),
        size: childSize,
      };
    });
  }

  // Decay dying asteroids
  for (const asteroid of state.asteroids) {
    if (asteroid.timeUntilDead !== undefined) {
      asteroid.timeUntilDead -= dt;
    }
  }

  // Bullet–asteroid collisions (point-in-radius)
  const bulletsToRemove = new Set<number>();
  const asteroidsToRemove = new Set<number>();
  const childrenToAdd: Asteroid[] = [];

  for (const [bulletIndex, bullet] of state.ship.bullets.entries()) {
    for (const [asteroidIndex, asteroid] of state.asteroids.entries()) {
      if (asteroid.timeUntilDead !== undefined) continue;
      if (bulletHitsAsteroidRadius(bullet, asteroid)) {
        state.ship.score += asteroid.size * 10;
        gamepads.singlePlayer.rumble(
          asteroid.size === Size.Big ? 80 : 50,
          asteroid.size === Size.Small ? HapticIntensity.Balanced : HapticIntensity.Heavy,
        );
        bulletsToRemove.add(bulletIndex);
        {
          const burst = spawnSparkBurst(asteroid.x, asteroid.y, {
            magnitude: asteroid.size,
            durationMs: explosionDurationMsAsteroid,
          });
          state.explosions = state.explosions.concat(burst);
          const soundSpeed = {
            [Size.Big]: 1,
            [Size.Med]: 2,
            [Size.Small]: 3,
          }[asteroid.size];
          sounds('explode').play({ volume: 1 / (soundSpeed ?? 1), speed: soundSpeed });
          state.screenShakeAmount = 1 / (20 - asteroid.size * 2);
        }
        if (asteroid.size === Size.Big || asteroid.size === Size.Med) {
          asteroidsToRemove.add(asteroidIndex);
          const children = splitAsteroid(asteroid);
          for (const child of children) {
            childrenToAdd.push(child);
          }
        } else {
          asteroid.timeUntilDead = explosionTtlMs;
        }
        break; // a bullet hits at most one asteroid
      }
    }
  }

  // Rebuild bullets
  state.ship.bullets = state.ship.bullets.filter((_, index) => !bulletsToRemove.has(index));

  // Rebuild asteroids and append children
  state.asteroids = state.asteroids
    .filter((asteroid, index) => asteroid.timeUntilDead !== undefined || !asteroidsToRemove.has(index))
    .concat(childrenToAdd);

  // Cull asteroids whose death timer has elapsed
  state.asteroids = state.asteroids.filter(
    (asteroid) => asteroid.timeUntilDead === undefined || asteroid.timeUntilDead > 0,
  );

  // Level clear -> seed next level
  if (state.asteroids.length === 0 && state.levelTransitionMs <= 0) {
    state.levelTransitionMs = 2000;
    sounds('levelup').play();
  }

  // Player collision, respawn, and invincibility
  {
    // Tick invincibility timer
    if (state.ship.invincibleMs > 0) {
      state.ship.invincibleMs = Math.max(0, state.ship.invincibleMs - dt);
    }

    // Handle respawn countdown and safe center respawn
    if (state.ship.respawnMs > 0) {
      state.ship.respawnMs = Math.max(0, state.ship.respawnMs - dt);
      if (state.ship.respawnMs === 0) {
        const centerX = worldWidthUnits / 2;
        const centerY = worldHeightUnits / 2;
        const safetyBuffer = state.ship.size * 1.5;
        const isSafe = state.asteroids.every((asteroid) => {
          if (asteroid.timeUntilDead !== undefined) return true;
          const dx = wrapDelta(centerX - asteroid.x, worldWidthUnits);
          const dy = wrapDelta(centerY - asteroid.y, worldHeightUnits);
          const r = asteroid.size + safetyBuffer;
          return dx * dx + dy * dy > r * r;
        });

        if (isSafe) {
          state.ship.x = centerX;
          state.ship.y = centerY;
          state.ship.invincibleMs = 2000;
        } else {
          // Try again shortly
          state.ship.respawnMs = 50;
        }
      }
    } else if (state.ship.invincibleMs <= 0) {
      // Only collide when alive and not invincible
      for (const asteroid of state.asteroids) {
        if (asteroid.timeUntilDead !== undefined) continue;
        const cosA = Math.cos(state.ship.angle);
        const sinA = Math.sin(state.ship.angle);
        const tipX = state.ship.x + cosA * state.ship.size;
        const tipY = state.ship.y + sinA * state.ship.size;
        if (
          pointHitsAsteroidRadius(state.ship.x, state.ship.y, asteroid) ||
          pointHitsAsteroidRadius(tipX, tipY, asteroid)
        ) {
          gamepads.singlePlayer.rumble(500, HapticIntensity.Heavy);
          state.ship.respawnMs = 2000;
          state.ship.invincibleMs = 0;
          state.ship.dx = 0;
          state.ship.dy = 0;
          state.ship.lives = Math.max(0, state.ship.lives - 1);
          {
            const burst = spawnSparkBurst(state.ship.x, state.ship.y, {
              magnitude: state.ship.size * 2.5,
              durationMs: explosionDurationMsShip,
            });
            state.explosions = state.explosions.concat(burst);
            sounds('kaboom').play({ volume: 0.5 });
            sounds('kaboomBass').play({ volume: 1 });
            state.screenShakeAmount = 1;
          }
          state.ship.bullets = [];
          if (state.ship.lives === 0) {
            state.mode = GameMode.Menu; // enter gameover/menu
            state.ship.respawnMs = 0;
            state.ship.invincibleMs = 0;
            sounds('gameover').play();
          }
          break;
        }
      }
    }
  }

  state.explosions = tickExplosions(state.explosions, dt, worldWidthUnits, worldHeightUnits);
  easeCameraToZero(state, dt);
  gamepads.clearInputs();
}

function drawUi(state: State, ctx: Ctx, viewport: Viewport) {
  const { v } = viewport;

  // Versus UI: Blue left, Red right; no lives
  if ((state.mode as GameMode) === GameMode.Versus) {
    ctx.save();
    ctx.font = `${8 * v}px Hyperspace`;
    ctx.textBaseline = 'top';

    // Blue score (left)
    ctx.fillStyle = Color.Blue;
    ctx.textAlign = 'left';
    ctx.fillText(`${state.players[0]?.score ?? 0}`, 10, 10);

    // Red score (right)
    ctx.fillStyle = Color.Red;
    ctx.textAlign = 'right';
    ctx.fillText(`${state.players[1]?.score ?? 0}`, viewport.rect.width - 10, 10);

    ctx.restore();
    return;
  }

  const margin = 4 * v; // margin from top and left

  // lives
  const totalLives = 5;
  const gap = 1.5 * v; // gap between lives icons

  const uiShipSizeUnits = state.ship.size;
  const shipPx = uiShipSizeUnits * v;
  const topY = margin + shipPx;
  const startX = margin + shipPx / 2;

  const { segs } = makeShipGeometry(shipPx);

  ctx.save();
  for (let i = 0; i < totalLives; i++) {
    // Full opacity for remaining lives, 50% for lost lives
    ctx.globalAlpha = i < state.ship.lives ? 1 : 0.5;
    const cx = startX + i * (shipPx + gap);
    drawShape(ctx, segs, cx, topY, -Math.PI / 2);
  }
  ctx.restore();

  // score
  ctx.font = `${8 * v}px Hyperspace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${state.ship.score}`, startX + totalLives * (shipPx + gap) + 2 * v, margin);
}

function draw(state: State, ctx: Ctx, viewport: Viewport) {
  {
    ctx.lineWidth = Math.max(viewport.v / 4, 1);
    ctx.strokeStyle = 'white';
    ctx.fillStyle = 'white';
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'round';
  }

  // level transition blackout screen
  if (state.levelTransitionMs > 0) {
    ctx.save();
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, viewport.rect.width, viewport.rect.height);

    // level text (next level number), centered
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${8 * viewport.v}px Hyperspace`;
    const nextLevelNum = state.level + 1;
    ctx.fillText(`LEVEL ${nextLevelNum}`, viewport.rect.width / 2, viewport.rect.height / 2);

    ctx.restore();
    return;
  }
  // draw ui before screenshake:
  if (state.mode === GameMode.Playing || (state.mode as GameMode) === GameMode.Versus) {
    drawUi(state, ctx, viewport);
  }

  ctx.save();

  // shake
  {
    const shakeStrength = 5;
    const wobbleSpeed = 0.2;
    ctx.translate(
      Math.sin(performance.now() * wobbleSpeed) * state.screenShakeAmount * viewport.v * shakeStrength,
      Math.sin(performance.now() * 1.5 * wobbleSpeed) * state.screenShakeAmount * viewport.v * shakeStrength,
    );
  }

  if (state.mode === GameMode.Playing) {
    drawShip(ctx, state.ship, viewport);
    drawBullets(ctx, state.ship.bullets, viewport);
  } else if ((state.mode as GameMode) === GameMode.Versus) {
    drawPlayersAndBullets(ctx, viewport);
  }

  ctx.strokeStyle = 'white';
  ctx.fillStyle = 'white';
  for (const asteroid of state.asteroids) {
    drawAsteroid(ctx, asteroid, viewport);
  }
  drawExplosions(ctx, state.explosions, viewport.v);

  if (state.mode === GameMode.Menu) {
    drawMenuOrGameOverOverlay(state, ctx, viewport);
  }

  ctx.restore();
}

type Point = readonly [number, number];
type Segment = readonly [Point, Point];

function drawShape(ctx: Ctx, segs: readonly Segment[], x: number, y: number, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  ctx.beginPath();
  for (const [[ax, ay], [bx, by]] of segs) {
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();
  ctx.restore();
}

function drawShip(ctx: Ctx, ship: Ship, { v }: Viewport) {
  // Hide while respawning
  if (ship.respawnMs > 0) return;

  // Flicker while invincible
  if (ship.invincibleMs > 0) {
    const phase = Math.floor(ship.invincibleMs / 100) % 2;
    if (phase === 0) return;
  }

  // todo: could store the segs and verts on state
  const { segs } = makeShipGeometry(ship.size * v, ship.isBoosting);
  drawShape(ctx, segs, ship.x * v, ship.y * v, ship.angle);
}

function drawBullets(ctx: Ctx, bullets: readonly Bullet[], { v }: Viewport) {
  if (bullets.length === 0) return;
  const radius = ctx.lineWidth;
  for (const bullet of bullets) {
    ctx.beginPath();
    ctx.ellipse(bullet.x * v, bullet.y * v, radius, radius, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAsteroid(ctx: Ctx, asteroid: Asteroid, { v }: Viewport) {
  const { segs } = makeAsteroidGeometry(asteroid.size * v, asteroid.variant);
  drawShape(ctx, segs, asteroid.x * v, asteroid.y * v, asteroid.angle);
}

function main() {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  let lastFrameTime = 0;
  let timeToProcessPhysics = 0;

  function gameLoop() {
    const now = performance.now();
    const maxDt = 100; // if returning to tab after some timem or some other weirdness, dt can be very big, so we clamp it to some max delta time to preserve snappiness.
    const dt = Math.min(now - lastFrameTime, maxDt);
    lastFrameTime = now;

    requestAnimationFrame(gameLoop);

    if (!ctx) return;

    const canvasRect = canvas.getBoundingClientRect();

    {
      canvas.width = canvasRect.width * window.devicePixelRatio;
      canvas.height = canvasRect.height * window.devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }

    const viewport = computeViewport(canvasRect);

    {
      timeToProcessPhysics += dt;
      const physicsHz = 240;
      const physicsTickMs = 1000 / physicsHz;

      while (timeToProcessPhysics > physicsTickMs) {
        timeToProcessPhysics -= physicsTickMs;
        update(state, physicsTickMs, viewport.worldWidthUnits, viewport.worldHeightUnits);
      }
    }

    {
      draw(state, ctx, viewport);
    }
  }

  gameLoop();
}

main();

window.addEventListener('click', () => {
  const audio = document.querySelector('audio')!;
  audio.volume = 0.2;
  audio.loop = true;
  audio.play();
});

export function easeCameraToZero(state: State, dt: number) {
  const animationSpeed = 0.01;
  state.screenShakeAmount = lerp(state.screenShakeAmount, 0, 1 - Math.exp(-animationSpeed * dt));
  if (state.screenShakeAmount < 0.001) state.screenShakeAmount = 0;
}
