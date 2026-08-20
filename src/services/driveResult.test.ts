import { describe, expect, it } from 'vitest';
import {
  SPEED_BAND_COLORS, colorForSpeed, createSpeedBands, createSpeedRouteSegments, fitDriveComposition,
  formatDriveDateTime, getAverageSpeedKmh, projectRoute,
  type DriveResultPoint,
} from './driveResultUtils';

const point = (latitude: number, longitude: number, speedKmh: number | null, recordedAt = '2026-08-20T00:00:00Z'): DriveResultPoint => ({
  latitude, longitude, speedKmh, recordedAt,
});

describe('drive result helpers', () => {
  it('creates five relative bands and assigns endpoints', () => {
    const bands = createSpeedBands([point(37, 127, 10), point(37.1, 127.1, 60)]);
    expect(bands).toHaveLength(5);
    expect(bands[0]).toMatchObject({ min: 10, max: 20 });
    expect(bands[4]).toMatchObject({ min: 50, max: 60 });
    expect(colorForSpeed(60, bands)).toBe(SPEED_BAND_COLORS[4]);
  });

  it('uses the middle color when speeds are equal or insufficient', () => {
    expect(createSpeedBands([point(37, 127, null)])).toEqual([
      { color: SPEED_BAND_COLORS[2], min: 0, max: 0 },
    ]);
    expect(createSpeedBands([point(37, 127, 30), point(37.1, 127.1, 30)])[0].color)
      .toBe(SPEED_BAND_COLORS[2]);
  });

  it('colors a final route segment using the final recorded speed', () => {
    const points = [
      point(37, 127, 10, '2026-08-20T00:00:00Z'),
      point(37.0001, 127.0001, 10, '2026-08-20T00:00:02Z'),
      point(37.0002, 127.0002, 60, '2026-08-20T00:00:04Z'),
    ];
    const bands = createSpeedBands(points);
    const segments = createSpeedRouteSegments(points.map((routePoint, index) => ({
      ...routePoint,
      x: index * 10,
      y: index * 5,
    })), bands);

    expect(segments).toHaveLength(2);
    expect(segments[0].color).toBe(SPEED_BAND_COLORS[0]);
    expect(segments[1]).toEqual({ color: SPEED_BAND_COLORS[4], path: 'M 10 5 L 20 10' });
  });

  it('does not draw a speed segment across a meaningful timestamp gap', () => {
    const points = [
      point(37, 127, 10, '2026-08-20T00:00:00Z'),
      point(37.0001, 127, 10, '2026-08-20T00:00:02Z'),
      point(37.1, 127, 10, '2026-08-20T00:02:00Z'),
      point(37.1001, 127, 10, '2026-08-20T00:02:02Z'),
    ].map((routePoint, index) => ({ ...routePoint, x: index * 10, y: index * 5 }));

    expect(createSpeedRouteSegments(points, createSpeedBands(points))).toEqual([
      { color: SPEED_BAND_COLORS[2], path: 'M 0 0 L 10 5' },
      { color: SPEED_BAND_COLORS[2], path: 'M 20 10 L 30 15' },
    ]);
  });

  it('calculates average speed from persisted distance and duration', () => {
    expect(getAverageSpeedKmh({
      distanceKm: 60,
      startedAt: '2026-08-20T00:00:00Z',
      endedAt: '2026-08-20T01:00:00Z',
    })).toBe(60);
  });

  it('fits projected points inside the requested frame', () => {
    const projected = projectRoute([point(37, 127, 10), point(38, 129, 20)], 300, 200, 20);
    for (const projectedPoint of projected) {
      expect(projectedPoint.x).toBeGreaterThanOrEqual(20);
      expect(projectedPoint.x).toBeLessThanOrEqual(280);
      expect(projectedPoint.y).toBeGreaterThanOrEqual(20);
      expect(projectedPoint.y).toBeLessThanOrEqual(180);
    }
  });

  it('fits a 4:5 composition inside wide and short regions', () => {
    expect(fitDriveComposition(400, 800)).toEqual({ width: 400, height: 500 });
    expect(fitDriveComposition(400, 300)).toEqual({ width: 240, height: 300 });
    expect(fitDriveComposition(0, 300)).toEqual({ width: 0, height: 0 });
  });

  it('formats date and time and handles invalid timestamps', () => {
    const formatted = formatDriveDateTime('2026-08-20T09:07:00');
    expect(formatted).toEqual({ date: '2026.08.20', time: '09:07' });
    expect(formatDriveDateTime('invalid')).toEqual({ date: '날짜 정보 없음', time: '--:--' });
  });
});
