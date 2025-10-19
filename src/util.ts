export function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

export function wrapWithMargin(value: number, max: number, margin: number) {
  const total = max + margin * 2;
  return ((((value + margin) % total) + total) % total) - margin;
}

export function exists<T>(value: T | undefined): value is T {
  return value !== undefined;
}

export function randomIntInRange(min: number, max: number) {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

export function sample<T>(array: readonly T[]): T | undefined {
  if (array.length === 0) return undefined;
  const index = Math.floor(Math.random() * array.length);
  return array[index];
}

export function wrapDelta(delta: number, span: number): number {
  let remainder = (delta + span / 2) % span;
  if (remainder < 0) remainder += span;
  return remainder - span / 2;
}

export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

export function randomBetween(min: number, max: number): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.random() * (high - low) + low;
}
