type Region = { x: number; y: number; width: number; height: number };
type ImageBox = Region & { angle?: number; scale?: readonly number[] };
/** Image-local normalized coordinates remain attached during move/resize/rotate/flip. */
export function projectImageRegion(image: ImageBox, region: Region) {
  const cx = image.x + image.width / 2, cy = image.y + image.height / 2;
  const angle = Number.isFinite(image.angle) ? image.angle! : 0;
  const c = Math.cos(angle), s = Math.sin(angle);
  return [[region.x, region.y], [region.x + region.width, region.y], [region.x + region.width, region.y + region.height], [region.x, region.y + region.height]].map(([x, y]) => {
    const dx = (x - 0.5) * image.width * (image.scale?.[0] ?? 1);
    const dy = (y - 0.5) * image.height * (image.scale?.[1] ?? 1);
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  });
}

/** Calculate the CENTER of a normalized bounding box on an image. */
export function getRegionCenter(
  image: { x: number; y: number; width: number; height: number },
  region: { x: number; y: number; width: number; height: number }
): { x: number; y: number } {
  return {
    x: image.x + (region.x + region.width / 2) * image.width,
    y: image.y + (region.y + region.height / 2) * image.height,
  };
}

