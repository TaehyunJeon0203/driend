export type TimestampValue = number | string;

export type RoutePointLike = {
  latitude: number;
  longitude: number;
  recordedAt?: TimestampValue;
};

export type LocationSample = RoutePointLike & {
  timestamp: number;
  accuracy: number | null;
  speed: number | null;
};

export type SampleValidationResult =
  | { accepted: true; distanceKm: number }
  | { accepted: false; reason: 'invalid' | 'accuracy' | 'duplicate' | 'timestamp' | 'jump' | 'stationary-jitter' };

export const MAX_LOCATION_ACCURACY_METERS = 50;
export const MAX_PLAUSIBLE_VEHICLE_SPEED_MPS = 220 / 3.6;
export const ROUTE_GAP_MS = 30_000;
export const ROUTE_GAP_DISTANCE_METERS = 2_000;

export function toPersistedSpeedKmh(speedKmh: number | null): number {
  return speedKmh ?? 0;
}

export function haversineMeters(a: Pick<RoutePointLike, 'latitude' | 'longitude'>, b: Pick<RoutePointLike, 'latitude' | 'longitude'>): number {
  const earthRadiusMeters = 6_371_000;
  const toRadians = Math.PI / 180;
  const deltaLatitude = (b.latitude - a.latitude) * toRadians;
  const deltaLongitude = (b.longitude - a.longitude) * toRadians;
  const latitudeA = a.latitude * toRadians;
  const latitudeB = b.latitude * toRadians;
  const h = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function validateLocationSample(
  sample: LocationSample,
  previous: LocationSample | null,
): SampleValidationResult {
  if (!Number.isFinite(sample.latitude) || !Number.isFinite(sample.longitude)
    || !Number.isFinite(sample.timestamp) || Math.abs(sample.latitude) > 90 || Math.abs(sample.longitude) > 180) {
    return { accepted: false, reason: 'invalid' };
  }
  if (!Number.isFinite(sample.accuracy) || sample.accuracy == null || sample.accuracy < 0
    || sample.accuracy > MAX_LOCATION_ACCURACY_METERS) {
    return { accepted: false, reason: 'accuracy' };
  }
  if (!previous) return { accepted: true, distanceKm: 0 };
  if (sample.timestamp <= previous.timestamp) return { accepted: false, reason: 'timestamp' };
  if (sample.latitude === previous.latitude && sample.longitude === previous.longitude) {
    return { accepted: false, reason: 'duplicate' };
  }

  const distanceMeters = haversineMeters(previous, sample);
  const elapsedSeconds = (sample.timestamp - previous.timestamp) / 1000;
  if (distanceMeters / elapsedSeconds > MAX_PLAUSIBLE_VEHICLE_SPEED_MPS) {
    return { accepted: false, reason: 'jump' };
  }

  // A stationary receiver commonly wanders inside its accuracy radius. Only apply this when the
  // platform explicitly reports a stationary speed so slow traffic with an unknown speed is kept.
  if (sample.speed != null && sample.speed >= 0 && sample.speed <= 1.5) {
    const jitterRadius = Math.min(20, Math.max(sample.accuracy, previous.accuracy ?? 0));
    if (distanceMeters <= jitterRadius) return { accepted: false, reason: 'stationary-jitter' };
  }

  return { accepted: true, distanceKm: distanceMeters / 1000 };
}

function timestampMs(point: RoutePointLike): number | null {
  if (point.recordedAt == null) return null;
  const value = typeof point.recordedAt === 'number' ? point.recordedAt : new Date(point.recordedAt).getTime();
  return Number.isFinite(value) ? value : null;
}

export function shouldSplitRoute(previous: RoutePointLike, next: RoutePointLike): boolean {
  const previousTimestamp = timestampMs(previous);
  const nextTimestamp = timestampMs(next);
  const distanceMeters = haversineMeters(previous, next);

  if (previousTimestamp != null && nextTimestamp != null) {
    const elapsedMs = nextTimestamp - previousTimestamp;
    if (elapsedMs <= 0 || elapsedMs > ROUTE_GAP_MS) return true;
    if (distanceMeters / (elapsedMs / 1000) > MAX_PLAUSIBLE_VEHICLE_SPEED_MPS) return true;
  }
  return distanceMeters > ROUTE_GAP_DISTANCE_METERS;
}

export function splitRouteSegments<T extends RoutePointLike>(points: T[]): T[][] {
  if (!points.length) return [];
  const segments: T[][] = [[points[0]]];
  for (let index = 1; index < points.length; index++) {
    const point = points[index];
    if (shouldSplitRoute(points[index - 1], point)) segments.push([point]);
    else segments[segments.length - 1].push(point);
  }
  return segments.filter((segment) => segment.length >= 2);
}
