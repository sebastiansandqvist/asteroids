function makeShipPoly(size = 10): [number, number][] {
  const noseX = size;
  const tailX = -size * 0.6;
  const halfY = size * 0.5;
  const footLen = size * 0.25;
  const footRise = halfY * 0.4;

  const innerTopX = tailX + footLen;
  const innerBotX = tailX + footLen;

  return [
    [noseX, 0], // tip
    [tailX, halfY], // rear bottom
    [innerBotX, footRise], // inner bottom
    [innerTopX, -footRise], // inner top
    [tailX, -halfY], // rear top
  ];
}
