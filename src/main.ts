import { Button, gamepads, HapticIntensity } from '@spud.gg/api';
import { makeAsteroidGeometry, makeShipGeometry } from './shapes';
import { wrapWithMargin } from './util';
import { state, type State } from './state';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

type Asteroid = State['asteroids'][number];
type Ship = State['ship'];
type Bullet = State['ship']['bullets'][number];

const maxActiveBullets = 50;

type Viewport = ReturnType<typeof computeViewport>;

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

function update(state: State, dt: number, worldWidthUnits: number, worldHeightUnits: number) {
  state.ship.x += state.ship.dx;
  state.ship.y += state.ship.dy;
  state.ship.x = wrapWithMargin(state.ship.x, worldWidthUnits, state.ship.size / 2);
  state.ship.y = wrapWithMargin(state.ship.y, worldHeightUnits, state.ship.size / 2);

  state.ship.isBoosting = gamepads.singlePlayer.leftStick.magnitude > 0.75;
  if (state.ship.isBoosting) {
    state.ship.angle = gamepads.singlePlayer.leftStick.angle;
    state.ship.dx += Math.cos(state.ship.angle) * gamepads.singlePlayer.leftStick.magnitude * 0.001 * dt;
    state.ship.dy += Math.sin(state.ship.angle) * gamepads.singlePlayer.leftStick.magnitude * 0.001 * dt;
  }

  {
    state.ship.fireCooldownMs = Math.max(0, state.ship.fireCooldownMs - dt);

    if (state.ship.fireCooldownMs <= 0 && isShooting()) {
      state.ship.fireCooldownMs = 200;
      const bulletSpeed = worldWidthUnits / 2 / 1000; // half the playfield width per second
      state.ship.bullets.push({
        x: state.ship.x + Math.cos(state.ship.angle) * state.ship.size,
        y: state.ship.y + Math.sin(state.ship.angle) * state.ship.size,
        dx: Math.cos(state.ship.angle) * bulletSpeed + state.ship.dx / dt,
        dy: Math.sin(state.ship.angle) * bulletSpeed + state.ship.dy / dt,
        ttlMs: 1000,
      });

      if (state.ship.bullets.length > maxActiveBullets) {
        state.ship.bullets[0]!.ttlMs = 0;
      }

      gamepads.singlePlayer.rumble(0.1, HapticIntensity.Light);
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

  gamepads.clearInputs();
}

function draw(state: State, ctx: Ctx, viewport: Viewport) {
  {
    ctx.lineWidth = Math.max(viewport.v / 4, 1);
    ctx.strokeStyle = 'white';
    ctx.fillStyle = 'white';
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'round';
  }

  drawShip(ctx, state.ship, viewport);
  drawBullets(ctx, state.ship.bullets, viewport);

  for (const asteroid of state.asteroids) {
    drawAsteroid(ctx, asteroid, viewport);
  }
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
      const physicsHz = 120;
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
