import { Button, gamepads, HapticIntensity } from '@spud.gg/api';
import { makeAsteroidGeometry, makeShipGeometry } from './shapes';
import { lerp, randomBetween, randomIntInRange, wrapDelta, wrapWithMargin } from './util';
import { GameMode, Size, state, type State } from './state';
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
  const scoreLine = `Score: ${state.ship.score}`;
  const button = gamepads.playerCount === 0 ? 'Connect a gamepad' : isGameOver ? 'Replay (A)' : 'Start (A)';

  // smaller box and padding
  const boxW = Math.min(rect.width * 0.45, 56 * v);
  const boxH = isGameOver ? 20 * v : 12 * v;
  const x = cx - boxW / 2;
  const y = cy - boxH / 2;

  ctx.save();

  // panel
  ctx.fillStyle = 'white';
  ctx.fillRect(x, y, boxW, boxH);

  // text
  ctx.fillStyle = 'black';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // unify text size to match score (8 * v) and consistent line spacing
  ctx.font = `${8 * v}px Hyperspace`;
  if (isGameOver) {
    ctx.fillText('GAME OVER', cx, cy - 8 * v);
  }

  ctx.font = `${8 * v}px Hyperspace`;
  ctx.fillText(button, cx, cy);

  if (isGameOver) {
    ctx.font = `${8 * v}px Hyperspace`;
    ctx.fillText(scoreLine, cx, cy + 8 * v);
  }

  ctx.restore();
}

function update(state: State, dt: number, worldWidthUnits: number, worldHeightUnits: number) {
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

    if (gamepads.singlePlayer.buttonJustPressed(Button.South)) {
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
    ctx.restore();
    return;
  }
  // draw ui before screenshake:
  if (state.mode === GameMode.Playing) {
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
  }

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
