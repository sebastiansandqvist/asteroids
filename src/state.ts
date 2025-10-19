export const GameMode = { Menu: 'Menu', Playing: 'Playing' } as const;

export const Size = {
  Big: 7,
  Med: 4,
  Small: 2,
} as const;

export const state = {
  mode: GameMode.Menu as GameMode,
  level: 1,
  screenShakeAmount: 0,
  baseAsteroidSizes: [] as number[],
  ship: {
    score: 0,
    lives: 5,
    x: 50,
    y: 50,
    dx: 0,
    dy: 0,
    angle: -Math.PI / 2,
    size: 2,
    isBoosting: false,
    fireCooldownMs: 0,
    invincibleMs: 0,
    respawnMs: 0,
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
    { x: 50, y: 20, dx: 0.01, dy: -0.01, angle: 0, dangle: 0.003, variant: 2, size: Size.Big },
    { x: 40, y: 0, dx: -0.01, dy: -0.01, angle: 0, dangle: -0.002, variant: 2, size: Size.Big },
    { x: 90, y: 70, dx: -0.01, dy: 0.01, angle: 0, dangle: 0.002, variant: 1, size: Size.Big },
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
  explosions: [] as {
    kind: 'spark';
    x: number;
    y: number;
    dx: number;
    dy: number;
    angle: number;
    spin: number;
    length: number;
    lifeMs: number;
    maxLifeMs: number;
    easing: 'linear' | 'easeOutQuad';
  }[],
};
state.baseAsteroidSizes = state.asteroids.map((a) => a.size);

export type GameMode = (typeof GameMode)[keyof typeof GameMode];
export type State = typeof state;
