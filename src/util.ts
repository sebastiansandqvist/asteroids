export function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

export function wrapWithMargin(value: number, max: number, margin: number) {
  const total = max + margin * 2;
  return ((((value + margin) % total) + total) % total) - margin;
}
