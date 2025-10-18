import { gamepads } from '@spud.gg/api';
import { makeAsteroidGeometry, makeShipGeometry } from './shapes';
import { wrapWithMargin } from './util';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const state = {
  ship: {
    x: 50,
    y: 50,
    dx: 0.2,
    dy: 0.1,
    angle: 0,
    size: 3,
  },
  asteroids: [
    {
      x: 20,
      y: 20,
      dx: 0.01,
      dy: 0.01,
      angle: 0,
      dangle: -0.001,
      variant: 0,
      size: 6,
    },
    {
      x: 90,
      y: 90,
      dx: -0.005,
      dy: -0.01,
      angle: 50,
      dangle: 0.0005,
      variant: 1,
      size: 3,
    },
    {
      x: 40,
      y: 90,
      dx: -0.002,
      dy: 0.004,
      angle: 50,
      dangle: 0.0005,
      variant: 3,
      size: 1,
    },
  ],
};

type State = typeof state;
type Asteroid = (typeof state.asteroids)[number];
type Ship = typeof state.ship;

type Viewport = ReturnType<typeof computeViewport>;

function computeViewport(rect: DOMRect) {
  const vw = rect.width / 100;
  const vh = rect.height / 100;
  const v = Math.min(vw, vh);
  const worldWidthUnits = rect.width / v;
  const worldHeightUnits = rect.height / v;
  return { vw, vh, v, worldWidthUnits, worldHeightUnits, rect };
}

function update(state: State, dt: number, worldWidthUnits: number, worldHeightUnits: number) {
  state.ship.x += state.ship.dx;
  state.ship.y += state.ship.dy;
  state.ship.x = wrapWithMargin(state.ship.x, worldWidthUnits, state.ship.size / 2);
  state.ship.y = wrapWithMargin(state.ship.y, worldHeightUnits, state.ship.size / 2);

  if (gamepads.singlePlayer.leftStick.magnitude > 0.75) {
    state.ship.angle = gamepads.singlePlayer.leftStick.angle;
    state.ship.dx += Math.cos(state.ship.angle) * dt * gamepads.singlePlayer.leftStick.magnitude * 0.001;
    state.ship.dy += Math.sin(state.ship.angle) * dt * gamepads.singlePlayer.leftStick.magnitude * 0.001;
  }

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
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'round';
  }

  drawShip(ctx, state.ship, viewport);

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
  const { segs } = makeShipGeometry(ship.size * v);
  drawShape(ctx, segs, ship.x * v, ship.y * v, ship.angle);
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
