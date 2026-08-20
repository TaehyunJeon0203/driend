import { describe, expect, it } from 'vitest';
import {
  AUTH_CONTENT_MAX_WIDTH,
  COMPACT_WINDOW_WIDTH,
  PHOTO_FRAME_MAX_WIDTH,
  TAB_CONTENT_MAX_WIDTH,
  fitAspectFrame,
  isCompactWindow,
  pageIndexFromOffset,
  preserveLegacyInset,
  resizeTranslation,
} from '../src/utils/responsiveLayout';

describe('responsive layout', () => {
  it('uses the shared compact and content-width boundaries', () => {
    // Given / When / Then
    expect(COMPACT_WINDOW_WIDTH).toBe(360);
    expect(AUTH_CONTENT_MAX_WIDTH).toBe(480);
    expect(TAB_CONTENT_MAX_WIDTH).toBe(720);
    expect(PHOTO_FRAME_MAX_WIDTH).toBe(720);
    expect(isCompactWindow(359)).toBe(true);
    expect(isCompactWindow(360)).toBe(false);
    expect(isCompactWindow(361)).toBe(false);
    expect(isCompactWindow(0)).toBe(false);
  });

  it('preserves the legacy offset unless the safe-area inset needs more room', () => {
    // Given
    const legacyOffset = 24;
    const spacing = 8;

    // When / Then
    expect(preserveLegacyInset(legacyOffset, 10, spacing)).toBe(24);
    expect(preserveLegacyInset(legacyOffset, 30, spacing)).toBe(38);
    expect(preserveLegacyInset(Number.NaN, Number.NaN, Number.NaN)).toBe(0);
  });

  it('fits wide and tall aspect frames within their limiting bounds', () => {
    // When
    const wideFrame = fitAspectFrame({
      aspect: 2,
      availableWidth: 1_000,
      availableHeight: 500,
    });
    const heightBoundFrame = fitAspectFrame({
      aspect: 0.5,
      availableWidth: 400,
      availableHeight: 300,
    });
    const tallFrame = fitAspectFrame({
      aspect: 0.5,
      availableWidth: 400,
      availableHeight: 1_000,
    });

    // Then
    expect(wideFrame).toEqual({ width: 720, height: 360 });
    expect(heightBoundFrame).toEqual({ width: 150, height: 300 });
    expect(tallFrame.width).toBeCloseTo(223.6);
    expect(tallFrame.height).toBeCloseTo(447.2);
  });

  it.each([
    { aspect: 0, availableWidth: 400, availableHeight: 300 },
    { aspect: 1, availableWidth: 0, availableHeight: 300 },
    { aspect: 1, availableWidth: 400, availableHeight: Number.NaN },
  ])('returns a zero frame for invalid dimensions', (input) => {
    // When / Then
    expect(fitAspectFrame(input)).toEqual({ width: 0, height: 0 });
  });

  it('resizes translations proportionally in both resize directions', () => {
    // When
    const enlarged = resizeTranslation(
      { x: 24, y: -15 },
      { width: 120, height: 60 },
      { width: 240, height: 120 },
    );
    const reduced = resizeTranslation(
      enlarged,
      { width: 240, height: 120 },
      { width: 120, height: 60 },
    );

    // Then
    expect(enlarged).toEqual({ x: 48, y: -30 });
    expect(reduced).toEqual({ x: 24, y: -15 });
  });

  it('returns finite zero translations for invalid frame dimensions', () => {
    // When / Then
    expect(resizeTranslation(
      { x: 24, y: -15 },
      { width: 0, height: Number.NaN },
      { width: 300, height: 30 },
    )).toEqual({ x: 0, y: 0 });
    expect(resizeTranslation(
      { x: 24, y: -15 },
      { width: 120, height: 60 },
      { width: Number.POSITIVE_INFINITY, height: -1 },
    )).toEqual({ x: 0, y: 0 });
  });

  it('rounds exact and half-page offsets before clamping to available items', () => {
    // When / Then
    expect(pageIndexFromOffset(200, 100, 4)).toBe(2);
    expect(pageIndexFromOffset(150, 100, 4)).toBe(2);
    expect(pageIndexFromOffset(149, 100, 4)).toBe(1);
    expect(pageIndexFromOffset(-80, 100, 4)).toBe(0);
    expect(pageIndexFromOffset(900, 100, 4)).toBe(3);
    expect(pageIndexFromOffset(100, 0, 4)).toBe(0);
    expect(pageIndexFromOffset(100, Number.NaN, 4)).toBe(0);
    expect(pageIndexFromOffset(100, 100, 0)).toBe(0);
  });
});
