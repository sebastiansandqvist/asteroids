type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const state = {
  player: {
    x: 50,
    y: 50,
    angle: 0,
  },
};

type State = typeof state;

function update(state: State, dt: number) {
  state.player.angle += 0.001 * dt;
  state.player.angle %= Math.PI * 2;
}

function draw(state: State, ctx: Ctx, rect: DOMRect) {
  const vw = rect.width / 100;
  const vh = rect.height / 100;
  const v = Math.min(vw, vh);

  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, rect.width, rect.height);

  drawAsteroid(ctx, state.player.x * v, state.player.y * v, 0, 10 * v);
  drawShip(ctx, state.player.x * v, state.player.y * v, state.player.angle, 10 * v);
}

// function drawShip(ctx: Ctx, x: number, y: number, angle: number, size: number) {
//   ctx.save();
//   ctx.translate(x, y);
//   ctx.rotate(angle);

//   ctx.strokeStyle = 'white';
//   ctx.lineWidth = Math.max(0.03 * size, 1);
//   ctx.lineJoin = 'miter';
//   ctx.lineCap = 'round';

//   const noseX = size;
//   const tailX = -size * 0.6;
//   const halfY = size * 0.5;

//   // feet geometry
//   const footLen = size * 0.25;
//   const footRise = halfY * 0.4; // how far inward the feet point

//   const innerTop = { x: tailX + footLen, y: -footRise };
//   const innerBot = { x: tailX + footLen, y: footRise };
//   const rearTop = { x: tailX, y: -halfY };
//   const rearBot = { x: tailX, y: halfY };

//   ctx.beginPath();

//   // sides
//   ctx.moveTo(noseX, 0);
//   ctx.lineTo(rearTop.x, rearTop.y);
//   ctx.moveTo(noseX, 0);
//   ctx.lineTo(rearBot.x, rearBot.y);

//   // feet
//   ctx.moveTo(rearTop.x, rearTop.y);
//   ctx.lineTo(innerTop.x, innerTop.y);
//   ctx.moveTo(rearBot.x, rearBot.y);
//   ctx.lineTo(innerBot.x, innerBot.y);

//   // base
//   ctx.moveTo(innerTop.x, innerTop.y);
//   ctx.lineTo(innerBot.x, innerBot.y);

//   ctx.stroke();
//   ctx.restore();
// }

function makeShipGeometry(size: number) {
  const noseX = size,
    tailX = -size * 0.6,
    halfY = size * 0.5;
  const footLen = size * 0.25,
    footRise = halfY * 0.4,
    innerX = tailX + footLen;

  const verts = [
    [noseX, 0], // 0 tip
    [tailX, halfY], // 1 rearBot
    [innerX, footRise], // 2 innerBot
    [innerX, -footRise], // 3 innerTop
    [tailX, -halfY], // 4 rearTop
  ] as const;

  const segs = [
    [verts[0], verts[4]], // tip->rearTop
    [verts[0], verts[1]], // tip->rearBot
    [verts[4], verts[3]], // rearTop->innerTop
    [verts[1], verts[2]], // rearBot->innerBot
    [verts[3], verts[2]], // base
  ] as const;

  return { verts, segs };
}

function drawShip(ctx: Ctx, x: number, y: number, angle: number, size: number) {
  const { segs } = makeShipGeometry(size);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = 'white';
  ctx.lineWidth = Math.max(0.03 * size, 1);
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

function makeAsteroidGeometry(size: number) {
  // Polar template: angles (deg) with radii multipliers. One shallow top notch and a right dent.
  // const polar: ReadonlyArray<readonly [number, number]> = [
  //   [-162, 0.92],
  //   [-132, 0.78],
  //   [-108, 0.86],
  //   [-84, 0.97], // shoulder before top notch
  //   [-58, 0.52], // deep top notch (inward)
  //   [-34, 0.98], // sharp exit -> near right-angle turn
  //   [6, 0.6], // right-side dent (inward)
  //   [36, 0.85],
  //   [96, 0.9],
  //   [162, 0.88],
  // ] as const;

  // const polar: ReadonlyArray<readonly [number, number]> = [
  //   [-170, 0.88],
  //   [-145, 0.92],
  //   [-122, 0.86],
  //   [-100, 0.93], // softened
  //   [-78, 0.88], // softened
  //   [-58, 0.82], // gentle top indent
  //   [-30, 0.94],
  //   [10, 0.84],
  //   [28, 0.62], // right indent
  //   [60, 0.9],
  //   [90, 0.94],
  //   [120, 0.3], // bottom-left indent
  // ] as const;

  const polar: ReadonlyArray<readonly [number, number]> = [
    [-165, 0.9],
    [-140, 0.82],
    [-118, 0.95],
    [-86, 0.88],
    [-55, 0.58], // top-right deep indent
    [-20, 0.96],
    [22, 0.88],
    [75, 0.94],
    [128, 0.92],
    [185, 0.3], // bottom indent
  ];

  const toRad = (d: number) => (d * Math.PI) / 180;

  const verts = polar.map(([deg, r]) => {
    const a = toRad(deg);
    return [Math.cos(a) * r * size, Math.sin(a) * r * size] as const;
  });

  const segs = verts.map((_, i) => [verts[i]!, verts[(i + 1) % verts.length]!] as const);

  return { verts: verts, segs } as const;
}

function drawAsteroid(ctx: Ctx, x: number, y: number, angle: number, size: number) {
  const { segs } = makeAsteroidGeometry(size);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  ctx.strokeStyle = 'white'; // or a gray like '#a8a8a8'
  ctx.lineWidth = Math.max(0.03 * size, 1);
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
