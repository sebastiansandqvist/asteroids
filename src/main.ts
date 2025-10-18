import { makeAsteroidGeometry, makeShipGeometry, getAsteroidVariantMaxRadius } from './shapes';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function wrapWithMargin(value: number, max: number, margin: number) {
  const total = max + margin * 2;
  return ((((value + margin) % total) + total) % total) - margin;
}

const state = {
  ship: {
    x: 50,
    y: 50,
    dx: 0,
    dy: 0,
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
  state.ship.angle += 0.001 * dt;
  state.ship.angle %= Math.PI * 2;

  state.asteroids.forEach((asteroid) => {
    asteroid.x += asteroid.dx * dt;
    asteroid.y += asteroid.dy * dt;
    asteroid.angle += asteroid.dangle * dt;
    asteroid.x = wrapWithMargin(asteroid.x, worldWidthUnits, asteroid.size);
    asteroid.y = wrapWithMargin(asteroid.y, worldHeightUnits, asteroid.size);
  });
}

function draw(state: State, ctx: Ctx, viewport: Viewport) {
  const { rect, v } = viewport;

  {
    ctx.lineWidth = Math.max(v / 4, 1);
    ctx.strokeStyle = 'white';
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'round';
  }

  drawShip(ctx, state.ship, viewport);

  for (const asteroid of state.asteroids) {
    drawAsteroid(ctx, asteroid, viewport);
  }
}

function drawShip(ctx: Ctx, ship: Ship, { v }: Viewport) {
  const { segs } = makeShipGeometry(ship.size * v);

  ctx.save();
  ctx.translate(ship.x * v, ship.y * v);
  ctx.rotate(ship.angle);

  ctx.beginPath();
  for (const [[ax, ay], [bx, by]] of segs) {
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();
  ctx.restore();
}

function drawAsteroid(ctx: Ctx, asteroid: Asteroid, { v }: Viewport) {
  // const rMax = getAsteroidVariantMaxRadius(asteroid.variant); // no longer in use.
  const scale = asteroid.size * v; // / (rMax || 1);
  const { segs } = makeAsteroidGeometry(scale, asteroid.variant);

  ctx.save();
  ctx.translate(asteroid.x * v, asteroid.y * v);
  ctx.rotate(asteroid.angle);

  ctx.beginPath();
  for (const [[ax, ay], [bx, by]] of segs) {
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();
  ctx.restore();
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
