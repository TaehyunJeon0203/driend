import { describe, expect, it } from 'vitest';
import {
  ZERO_TO_HUNDRED_GPS_LAG_MS,
  calculateZeroToHundredSeconds,
  type SpeedSample,
} from './zeroToHundred';

const startTimestampMs = 1_000;

describe('calculateZeroToHundredSeconds', () => {
  it('interpolates the 100 km/h crossing from the recent acceleration rate', () => {
    // Given
    const samples: readonly SpeedSample[] = [
      { timestampMs: 5_000, speedKmh: 20 },
      { timestampMs: 6_000, speedKmh: 40 },
      { timestampMs: 7_000, speedKmh: 60 },
      { timestampMs: 8_000, speedKmh: 80 },
      { timestampMs: 9_500, speedKmh: 110 },
    ];

    // When
    const result = calculateZeroToHundredSeconds({ startTimestampMs, samples });

    // Then
    expect(result).toBe(7.2);
  });

  it('falls back to the latest segment when fewer than two historical rates are usable', () => {
    // Given
    const samples: readonly SpeedSample[] = [
      { timestampMs: 7_000, speedKmh: 80 },
      { timestampMs: 9_000, speedKmh: 120 },
    ];

    // When
    const result = calculateZeroToHundredSeconds({ startTimestampMs, samples });

    // Then
    expect(result).toBe(6.2);
  });

  it('clamps a historical-rate crossing to the current GPS timestamp', () => {
    // Given
    const samples: readonly SpeedSample[] = [
      { timestampMs: 5_000, speedKmh: 6 },
      { timestampMs: 6_000, speedKmh: 7 },
      { timestampMs: 7_000, speedKmh: 8 },
      { timestampMs: 8_000, speedKmh: 1 },
      { timestampMs: 9_000, speedKmh: 90 },
      { timestampMs: 10_000, speedKmh: 110 },
    ];

    // When
    const result = calculateZeroToHundredSeconds({ startTimestampMs, samples });

    // Then
    expect(result).toBe(8.2);
  });

  it.each([
    {
      name: 'a non-increasing fallback timestamp',
      samples: [
        { timestampMs: 9_000, speedKmh: 80 },
        { timestampMs: 9_000, speedKmh: 100 },
      ],
      expected: 7.2,
    },
    {
      name: 'a non-positive fallback rate',
      samples: [
        { timestampMs: 8_000, speedKmh: 105 },
        { timestampMs: 9_000, speedKmh: 100 },
      ],
      expected: 7.2,
    },
    {
      name: 'a timestamp before measurement start',
      samples: [{ timestampMs: 500, speedKmh: 100 }],
      expected: null,
    },
    {
      name: 'a non-finite speed rate',
      samples: [{ timestampMs: 9_000, speedKmh: Number.NaN }],
      expected: null,
    },
  ])('handles $name without producing an invalid result', ({ samples, expected }) => {
    // Given / When
    const result = calculateZeroToHundredSeconds({ startTimestampMs, samples });

    // Then
    expect(result).toBe(expected);
  });

  it('rounds to one decimal place after applying calibration exactly once', () => {
    // Given
    const samples: readonly SpeedSample[] = [{ timestampMs: 9_845, speedKmh: 100 }];

    // When
    const result = calculateZeroToHundredSeconds({ startTimestampMs, samples });

    // Then
    expect(result).toBe(8.1);
  });

  it('uses 780ms calibration so the former 980ms result was 0.2s too optimistic', () => {
    // Given
    const rawElapsedMs = 10_000;
    const formerResult = Math.round((rawElapsedMs - 980) / 100) / 10;
    const samples: readonly SpeedSample[] = [
      { timestampMs: startTimestampMs + rawElapsedMs, speedKmh: 100 },
    ];

    // When
    const correctedResult = calculateZeroToHundredSeconds({ startTimestampMs, samples });

    // Then
    expect(ZERO_TO_HUNDRED_GPS_LAG_MS).toBe(780);
    expect(correctedResult).toBe(formerResult + 0.2);
  });
});
