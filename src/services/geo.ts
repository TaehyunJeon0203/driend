export type LatLng = { latitude: number; longitude: number };
export type BBox = { minLat: number; maxLat: number; minLng: number; maxLng: number };

export function bboxOfPolygons(polygons: LatLng[][]): BBox {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const ring of polygons) {
    for (const p of ring) {
      if (p.latitude < minLat) minLat = p.latitude;
      if (p.latitude > maxLat) maxLat = p.latitude;
      if (p.longitude < minLng) minLng = p.longitude;
      if (p.longitude > maxLng) maxLng = p.longitude;
    }
  }
  return { minLat, maxLat, minLng, maxLng };
}

function inBBox(pt: LatLng, box: BBox): boolean {
  return pt.latitude >= box.minLat && pt.latitude <= box.maxLat &&
    pt.longitude >= box.minLng && pt.longitude <= box.maxLng;
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.minLat <= b.maxLat && a.maxLat >= b.minLat &&
    a.minLng <= b.maxLng && a.maxLng >= b.minLng;
}

/** 뷰포트 컬링 시 화면 가장자리에서 지역이 갑자기 팝인/아웃 되는 걸 완화하기 위한 여유분. */
export function padBBox(box: BBox, ratio: number): BBox {
  const latPad = (box.maxLat - box.minLat) * ratio;
  const lngPad = (box.maxLng - box.minLng) * ratio;
  return {
    minLat: box.minLat - latPad, maxLat: box.maxLat + latPad,
    minLng: box.minLng - lngPad, maxLng: box.maxLng + lngPad,
  };
}

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

/** 도시별 bbox를 1회 계산해 캐싱 — point-in-polygon 전에 저렴하게 후보를 걸러냄. */
export function buildCityIndex<T extends { polygons: LatLng[][] }>(cities: T[]) {
  return cities.map((city) => ({ city, bbox: bboxOfPolygons(city.polygons) }));
}

export function matchCity<T extends { polygons: LatLng[][] }>(
  pt: LatLng,
  index: { city: T; bbox: BBox }[]
): T | null {
  for (const { city, bbox } of index) {
    if (!inBBox(pt, bbox)) continue;
    if (pointInPolygons(pt, city.polygons)) return city;
  }
  return null;
}

/** 좌표 목록을 격자로 축약한 뒤 도시 폴리곤과 매칭 (code -> name 맵 반환). */
export function matchVisitedCities<T extends { code: string; name: string; polygons: LatLng[][] }>(
  coords: LatLng[],
  index: { city: T; bbox: BBox }[]
): Map<string, string> {
  const points = dedupeByGrid(coords);
  const matched = new Map<string, string>();
  for (const pt of points) {
    const city = matchCity(pt, index);
    if (city) matched.set(city.code, city.name);
  }
  return matched;
}
