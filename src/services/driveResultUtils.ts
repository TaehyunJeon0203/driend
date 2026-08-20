import { shouldSplitRoute } from './routeTrackingUtils';

export type DriveResultPoint = {
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  recordedAt: string;
};

export type DriveResult = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  distanceKm: number;
  maxSpeedKmh: number;
  resultImageUrl: string | null;
  startAddress: string | null;
  endAddress: string | null;
  points: DriveResultPoint[];
};

export const SPEED_BAND_COLORS = ['#2563EB', '#06B6D4', '#22C55E', '#F59E0B', '#EF4444'] as const;

export type SpeedBand = { color: string; min: number; max: number };

const DRIVE_COMPOSITION_ASPECT = 4 / 5;

export function fitDriveComposition(availableWidth: number, availableHeight: number): { width: number; height: number } {
  if (availableWidth <= 0 || availableHeight <= 0) return { width: 0, height: 0 };
  const width = Math.min(availableWidth, availableHeight * DRIVE_COMPOSITION_ASPECT);
  return { width, height: width / DRIVE_COMPOSITION_ASPECT };
}

export function formatDriveDateTime(value: string): { date: string; time: string } {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return { date: '날짜 정보 없음', time: '--:--' };
  const pad = (part: number) => part.toString().padStart(2, '0');
  return {
    date: `${parsed.getFullYear()}.${pad(parsed.getMonth() + 1)}.${pad(parsed.getDate())}`,
    time: `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`,
  };
}

export function getDurationSeconds(result: Pick<DriveResult, 'startedAt' | 'endedAt'>): number {
  if (!result.endedAt) return 0;
  const duration = (new Date(result.endedAt).getTime() - new Date(result.startedAt).getTime()) / 1000;
  return Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : 0;
}

export function getAverageSpeedKmh(result: Pick<DriveResult, 'distanceKm' | 'startedAt' | 'endedAt'>): number {
  const durationSeconds = getDurationSeconds(result);
  return durationSeconds > 0 ? result.distanceKm / (durationSeconds / 3600) : 0;
}

export function formatDriveDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  if (minutes > 0) return `${minutes}분 ${seconds}초`;
  return `${seconds}초`;
}

export function createSpeedBands(points: DriveResultPoint[]): SpeedBand[] {
  const speeds = points
    .map((point) => point.speedKmh)
    .filter((speed): speed is number => speed != null && Number.isFinite(speed) && speed >= 0);
  if (speeds.length < 2) return [{ color: SPEED_BAND_COLORS[2], min: speeds[0] ?? 0, max: speeds[0] ?? 0 }];
  const min = Math.min(...speeds);
  const max = Math.max(...speeds);
  if (max - min < 0.1) return [{ color: SPEED_BAND_COLORS[2], min, max }];
  const step = (max - min) / SPEED_BAND_COLORS.length;
  return SPEED_BAND_COLORS.map((color, index) => ({
    color,
    min: min + step * index,
    max: index === SPEED_BAND_COLORS.length - 1 ? max : min + step * (index + 1),
  }));
}

export function colorForSpeed(speed: number | null, bands: SpeedBand[]): string {
  if (bands.length === 1 || speed == null || !Number.isFinite(speed)) return SPEED_BAND_COLORS[2];
  const index = bands.findIndex((band, bandIndex) => speed < band.max || bandIndex === bands.length - 1);
  return bands[Math.max(0, index)].color;
}

export type ProjectedPoint = DriveResultPoint & { x: number; y: number };

export type SpeedRouteSegment = { color: string; path: string };

export function createSpeedRouteSegments(points: ProjectedPoint[], bands: SpeedBand[]): SpeedRouteSegment[] {
  if (points.length < 2) return [];
  const output: SpeedRouteSegment[] = [];
  let color: string | null = null;
  let path: string | null = null;

  for (let index = 1; index < points.length; index++) {
    const point = points[index];
    const previous = points[index - 1];
    if (shouldSplitRoute(previous, point)) {
      if (color && path) output.push({ color, path });
      color = null;
      path = null;
      continue;
    }
    const nextColor = colorForSpeed(point.speedKmh, bands);
    if (!path || color == null) {
      color = nextColor;
      path = `M ${previous.x} ${previous.y} L ${point.x} ${point.y}`;
    } else if (nextColor !== color) {
      output.push({ color, path });
      color = nextColor;
      path = `M ${previous.x} ${previous.y} L ${point.x} ${point.y}`;
    } else {
      path += ` L ${point.x} ${point.y}`;
    }
  }

  if (color && path) output.push({ color, path });
  return output;
}

export function projectRoute(points: DriveResultPoint[], width: number, height: number, padding = 24): ProjectedPoint[] {
  if (!points.length || width <= 0 || height <= 0) return [];
  const meanLatitude = points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  const longitudeScale = Math.max(0.01, Math.cos(meanLatitude * Math.PI / 180));
  const geoPoints = points.map((point) => ({ point, x: point.longitude * longitudeScale, y: -point.latitude }));
  const minX = Math.min(...geoPoints.map((point) => point.x));
  const maxX = Math.max(...geoPoints.map((point) => point.x));
  const minY = Math.min(...geoPoints.map((point) => point.y));
  const maxY = Math.max(...geoPoints.map((point) => point.y));
  const geoWidth = Math.max(maxX - minX, 0.000001);
  const geoHeight = Math.max(maxY - minY, 0.000001);
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const scale = Math.min(availableWidth / geoWidth, availableHeight / geoHeight);
  const offsetX = (width - geoWidth * scale) / 2;
  const offsetY = (height - geoHeight * scale) / 2;
  return geoPoints.map(({ point, x, y }) => ({
    ...point,
    x: offsetX + (x - minX) * scale,
    y: offsetY + (y - minY) * scale,
  }));
}
