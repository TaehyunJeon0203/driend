export type LatLng = { latitude: number; longitude: number };

function pointInRing(pt: LatLng, ring: LatLng[]): boolean {
  const x = pt.longitude;
  const y = pt.latitude;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].longitude, yi = ring[i].latitude;
    const xj = ring[j].longitude, yj = ring[j].latitude;
    const intersects = yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInPolygons(pt: LatLng, polygons: LatLng[][]): boolean {
  for (const ring of polygons) {
    if (pointInRing(pt, ring)) return true;
  }
  return false;
}

/** ~1.1km grid rounding — collapses dense GPS samples before expensive polygon tests. */
export function dedupeByGrid(coords: LatLng[], precision = 2): LatLng[] {
  const seen = new Set<string>();
  const result: LatLng[] = [];
  for (const c of coords) {
    const key = `${c.latitude.toFixed(precision)},${c.longitude.toFixed(precision)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(c);
  }
  return result;
}
