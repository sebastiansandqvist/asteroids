export const Size = {
  Big: 7,
  Med: 4,
  Small: 2,
} as const;

export const state = {
  ship: {
    x: 50,
    y: 50,
    dx: 0.2,
    dy: 0.1,
    angle: 0,
    size: 2,
    isBoosting: false,
    fireCooldownMs: 0,
    bullets: [] as {
      x: number;
      y: number;
      dx: number;
      dy: number;
      ttlMs: number;
    }[],
  },
  asteroids: [
    { x: 20, y: 20, dx: 0.01, dy: 0.01, angle: 0, dangle: -0.001, variant: 0, size: Size.Big },
    { x: 90, y: 90, dx: -0.005, dy: -0.01, angle: 50, dangle: 0.0005, variant: 1, size: Size.Med },
    { x: 40, y: 90, dx: -0.002, dy: 0.004, angle: 50, dangle: 0.0005, variant: 3, size: Size.Small },
  ] as {
    x: number;
    y: number;
    dx: number;
    dy: number;
    angle: number;
    dangle: number;
    variant: number;
    size: number;
    timeUntilDead?: number;
  }[],
};

export type State = typeof state;
