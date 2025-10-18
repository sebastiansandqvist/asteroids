export const state = {
  ship: {
    x: 50,
    y: 50,
    dx: 0.2,
    dy: 0.1,
    angle: 0,
    size: 3,
    isBoosting: false,
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

export type State = typeof state;
