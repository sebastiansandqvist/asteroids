import { degreesToRadians } from './util';

export function makeShipGeometry(size: number) {
  const noseX = size;
  const tailX = -size * 0.6;
  const halfY = size * 0.5;
  const footLen = size * 0.25;
  const footRise = halfY * 0.4;
  const innerX = tailX + footLen;

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

const asteroidVariants = [
  [
    [-162, 0.92],
    [-132, 0.78],
    [-108, 0.86],
    [-84, 0.97], // shoulder before top notch
    [-58, 0.52], // deep top notch (inward)
    [-34, 0.98], // sharp exit -> near right-angle turn
    [6, 0.6], // right-side dent (inward)
    [36, 0.85],
    [96, 0.9],
    [162, 0.88],
  ],

  [
    [-170, 0.88],
    [-145, 0.92],
    [-122, 0.86],
    [-100, 0.93], // softened
    [-78, 0.88], // softened
    [-58, 0.82], // gentle top indent
    [-30, 0.94],
    [10, 0.84],
    [28, 0.62], // right indent
    [60, 0.9],
    [90, 0.94],
    [120, 0.3], // bottom-left indent
  ],

  [
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
  ],
] as const;

export function makeAsteroidGeometry(size: number, variant: number) {
  const asteroid = asteroidVariants[variant % asteroidVariants.length]!;

  const verts = asteroid.map(([deg, r]) => {
    const a = degreesToRadians(deg);
    return [Math.cos(a) * r * size, Math.sin(a) * r * size] as const;
  });

  const segs = verts.map((_, i) => [verts[i]!, verts[(i + 1) % verts.length]!] as const);

  return { verts: verts, segs } as const;
}
