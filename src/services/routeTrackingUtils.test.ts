import { describe, expect, it } from 'vitest';
import {
  splitRouteSegments,
  toPersistedSpeedKmh,
  validateLocationSample,
  type LocationSample,
} from './routeTrackingUtils';

const sample = (overrides: Partial<LocationSample> = {}): LocationSample => ({
  latitude: 37.5,
  longitude: 127,
  timestamp: 1_000,
  accuracy: 8,
  speed: 10,
  ...overrides,
});

describe('location sample validation', () => {
  it('rejects duplicate coordinates and non-increasing timestamps', () => {
    const previous = sample();
    expect(validateLocationSample(sample({ timestamp: 2_000 }), previous)).toMatchObject({ accepted: false, reason: 'duplicate' });
    expect(validateLocationSample(sample({ longitude: 127.001, timestamp: 1_000 }), previous)).toMatchObject({ accepted: false, reason: 'timestamp' });
  });

  it('rejects poor accuracy, implausible jumps, and stationary jitter', () => {
    const previous = sample({ speed: 0 });
    expect(validateLocationSample(sample({ accuracy: 80 }), null)).toMatchObject({ accepted: false, reason: 'accuracy' });
    expect(validateLocationSample(sample({ longitude: 127.01, timestamp: 2_000 }), previous)).toMatchObject({ accepted: false, reason: 'jump' });
    expect(validateLocationSample(sample({ longitude: 127.00005, timestamp: 2_000, speed: 0 }), previous)).toMatchObject({ accepted: false, reason: 'stationary-jitter' });
  });

  it('returns only accepted movement for distance accounting while preserving speed input', () => {
    const next = sample({ longitude: 127.0001, timestamp: 3_000, speed: 7.25 });
    const result = validateLocationSample(next, sample());
    expect(result.accepted && result.distanceKm).toBeGreaterThan(0);
    expect(next.speed).toBe(7.25);
  });
});

describe('route point persistence', () => {
  it('uses zero for unknown speed while preserving reported speed', () => {
    expect(toPersistedSpeedKmh(null)).toBe(0);
    expect(toPersistedSpeedKmh(42.5)).toBe(42.5);
  });
});

describe('route gap segmentation', () => {
  it('splits timestamp gaps and implausible or very large untimed gaps', () => {
    const timestamped = [
      { latitude: 37.5, longitude: 127, recordedAt: 0 },
      { latitude: 37.5001, longitude: 127, recordedAt: 2_000 },
      { latitude: 37.6, longitude: 127, recordedAt: 60_000 },
      { latitude: 37.6001, longitude: 127, recordedAt: 62_000 },
    ];
    expect(splitRouteSegments(timestamped)).toEqual([timestamped.slice(0, 2), timestamped.slice(2)]);

    const untimed = [
      { latitude: 37.5, longitude: 127 },
      { latitude: 37.5001, longitude: 127 },
      { latitude: 37.6, longitude: 127 },
      { latitude: 37.6001, longitude: 127 },
    ];
    expect(splitRouteSegments(untimed)).toEqual([untimed.slice(0, 2), untimed.slice(2)]);
  });
});
