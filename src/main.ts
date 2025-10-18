import { makeAsteroidGeometry, makeShipGeometry } from './shapes';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const state = {
  player: {
    x: 50,
    y: 50,
    angle: 0,
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
      size: 3,
    },
    {
      x: 90,
      y: 90,
      dx: -0.005,
      dy: -0.01,
      angle: 50,
      dangle: 0.0005,
      variant: 1,
      size: 1.5,
    },
    {
      x: 40,
      y: 90,
      dx: -0.002,
      dy: 0.004,
      angle: 50,
      dangle: 0.0005,
      variant: 3,
      size: 0.5,
    },
  ],
};

type State = typeof state;
type Asteroid = (typeof state.asteroids)[number];

function update(state: State, dt: number) {
  state.player.angle += 0.001 * dt;
  state.player.angle %= Math.PI * 2;

  state.asteroids.forEach((asteroid) => {
    asteroid.x += asteroid.dx * dt;
    asteroid.y += asteroid.dy * dt;
    asteroid.angle += asteroid.dangle * dt;
  });
}

function draw(state: State, ctx: Ctx, rect: DOMRect) {
  const vw = rect.width / 100;
  const vh = rect.height / 100;
  const v = Math.min(vw, vh);

  ctx.lineWidth = Math.max(v / 4, 1);

  // blackout bg
  {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, rect.width, rect.height);
  }

  drawShip(ctx, state.player.x * v, state.player.y * v, state.player.angle, 2 * v);

  for (const asteroid of state.asteroids) {
    drawAsteroid(ctx, asteroid, asteroid.x * v, asteroid.y * v, v * 2 * asteroid.size);
  }
}

function drawShip(ctx: Ctx, x: number, y: number, angle: number, size: number) {
  const { segs } = makeShipGeometry(size);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = 'white';
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'round';

  ctx.beginPath();
  for (const [[ax, ay], [bx, by]] of segs) {
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();
  ctx.restore();
}

function drawAsteroid(ctx: Ctx, asteroid: Asteroid, x: number, y: number, size: number) {
  const { segs } = makeAsteroidGeometry(size, asteroid.variant);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(asteroid.angle);

  ctx.strokeStyle = 'white'; // or a gray like '#a8a8a8'
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

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
      ctx.scale(devicePixelRatio, devicePixelRatio);
    }

    {
      timeToProcessPhysics += dt;
      const physicsHz = 120;
      const physicsTickMs = 1000 / physicsHz;
      while (timeToProcessPhysics > physicsTickMs) {
        timeToProcessPhysics -= physicsTickMs;
        update(state, physicsTickMs);
      }
    }

    {
      draw(state, ctx, canvasRect);
    }
  }

  gameLoop();
}

main();
