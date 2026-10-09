/**
 * The Spine fold Samuel tried. x is 0 at the gutter and 1 at the outer edge.
 * A turned point is mirrored across a straight fold. Only a narrow ridge lifts,
 * so the sheet does not roll into a tube.
 */
export const SPINE_W = 1;
export const SPINE_H = 1.35;

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

export function spinePoint(x: number, y: number, p: number) {
  const fold = SPINE_W * (1 - p);
  const dist = x - fold;
  const life = Math.sin(Math.PI * p);
  const bow = Math.sin(Math.PI * clamp01(x / SPINE_W)) * 0.012 * SPINE_H * life;
  if (dist <= 0) {
    return { x, y, z: bow, crease: 0, back: false };
  }
  const sigma = SPINE_W * 0.048;
  const ridge = Math.exp(-(dist * dist) / (2 * sigma * sigma));
  return {
    x: fold - dist,
    y,
    z: SPINE_H * 0.09 * life * ridge + 0.05,
    crease: ridge * life,
    back: true,
  };
}

/** How much of the sheet is bending, and whether each turned point is a mirror. */
export function measureSpine(p: number) {
  const fold = SPINE_W * (1 - p);
  let maxZ = 0;
  let n = 0;
  let high = 0;
  let mirrors = true;
  const across = 48;
  const down = 8;
  for (let i = 0; i < across; i++) {
    const x = ((i + 0.5) / across) * SPINE_W;
    for (let j = 0; j < down; j++) {
      const y = ((j + 0.5) / down) * SPINE_H;
      const point = spinePoint(x, y, p);
      n += 1;
      maxZ = Math.max(maxZ, point.z);
      if (point.crease > 0.35) high += 1;
      const dist = x - fold;
      if (dist > 0) {
        if (!point.back || Math.abs(point.x - (fold - dist)) > 1e-9) mirrors = false;
      } else if (point.back || Math.abs(point.x - x) > 1e-9) {
        mirrors = false;
      }
    }
  }
  return { maxZ, highCreaseFraction: high / n, mirrors };
}
