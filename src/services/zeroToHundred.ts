export const ZERO_TO_HUNDRED_GPS_LAG_MS = 780;

const RATE_WINDOW_SEGMENTS = 4;
const TARGET_SPEED_KMH = 100;

export type SpeedSample = {
  readonly timestampMs: number;
  readonly speedKmh: number;
};

export type ZeroToHundredInput = {
  readonly startTimestampMs: number;
  readonly samples: readonly SpeedSample[];
};

export function calculateZeroToHundredSeconds({
  startTimestampMs,
  samples,
}: ZeroToHundredInput): number | null {
  const current = samples.at(-1);
  if (
    !current ||
    !Number.isFinite(startTimestampMs) ||
    !Number.isFinite(current.timestampMs) ||
    !Number.isFinite(current.speedKmh)
  ) return null;
  if (current.speedKmh < TARGET_SPEED_KMH || current.timestampMs < startTimestampMs) return null;

  let crossingTimestampMs = current.timestampMs;
  const previous = samples.at(-2);
  if (previous && previous.speedKmh < TARGET_SPEED_KMH && previous.timestampMs < current.timestampMs) {
    const previousSamples = samples.slice(0, -1).slice(-(RATE_WINDOW_SEGMENTS + 1));
    const rates: number[] = [];
    for (let index = 1; index < previousSamples.length; index += 1) {
      const earlier = previousSamples[index - 1];
      const later = previousSamples[index];
      if (!earlier || !later) continue;
      const speedDelta = later.speedKmh - earlier.speedKmh;
      const timestampDelta = later.timestampMs - earlier.timestampMs;
      if (timestampDelta > 0 && speedDelta > 0 && earlier.speedKmh > 5) {
        rates.push(speedDelta / timestampDelta);
      }
    }

    const fallbackRate = (current.speedKmh - previous.speedKmh) /
      (current.timestampMs - previous.timestampMs);
    const rate = rates.length >= 2
      ? rates.reduce((sum, value) => sum + value, 0) / rates.length
      : fallbackRate;
    if (Number.isFinite(rate) && rate > 0) {
      const interpolatedTimestampMs = previous.timestampMs +
        (TARGET_SPEED_KMH - previous.speedKmh) / rate;
      crossingTimestampMs = Math.min(
        current.timestampMs,
        Math.max(previous.timestampMs, interpolatedTimestampMs),
      );
    }
  }

  const correctedMilliseconds = Math.max(
    0,
    crossingTimestampMs - startTimestampMs - ZERO_TO_HUNDRED_GPS_LAG_MS,
  );
  if (!Number.isFinite(correctedMilliseconds)) return null;
  return Math.round(correctedMilliseconds / 100) / 10;
}
