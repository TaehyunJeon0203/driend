export const COMPACT_WINDOW_WIDTH = 360;
export const AUTH_CONTENT_MAX_WIDTH = 480;
export const TAB_CONTENT_MAX_WIDTH = 720;
export const PHOTO_FRAME_MAX_WIDTH = 720;

export type FrameSize = {
  readonly width: number;
  readonly height: number;
};

export type Translation = {
  readonly x: number;
  readonly y: number;
};

export type AspectFrameInput = {
  readonly aspect: number;
  readonly availableWidth: number;
  readonly availableHeight: number;
};

function positiveOrZero(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function isCompactWindow(width: number): boolean {
  return Number.isFinite(width) && width > 0 && width < COMPACT_WINDOW_WIDTH;
}

export function preserveLegacyInset(
  legacyOffset: number,
  inset: number,
  spacing: number,
): number {
  return Math.max(
    positiveOrZero(legacyOffset),
    positiveOrZero(inset) + positiveOrZero(spacing),
  );
}

export function fitAspectFrame({
  aspect,
  availableWidth,
  availableHeight,
}: AspectFrameInput): FrameSize {
  if (
    !Number.isFinite(aspect) ||
    aspect <= 0 ||
    !Number.isFinite(availableWidth) ||
    availableWidth <= 0 ||
    !Number.isFinite(availableHeight) ||
    availableHeight <= 0
  ) {
    return { width: 0, height: 0 };
  }

  const maxWidth = Math.min(availableWidth * 0.86, PHOTO_FRAME_MAX_WIDTH);
  const maxHeight = Math.min(availableHeight, maxWidth * 1.3);
  const width = Math.min(maxWidth, maxHeight * aspect);

  return { width, height: width / aspect };
}

export function resizeTranslation(
  translation: Translation,
  previousFrame: FrameSize,
  nextFrame: FrameSize,
): Translation {
  const x = Number.isFinite(translation.x) &&
    Number.isFinite(previousFrame.width) && previousFrame.width > 0 &&
    Number.isFinite(nextFrame.width) && nextFrame.width > 0
    ? translation.x * (nextFrame.width / previousFrame.width)
    : 0;
  const y = Number.isFinite(translation.y) &&
    Number.isFinite(previousFrame.height) && previousFrame.height > 0 &&
    Number.isFinite(nextFrame.height) && nextFrame.height > 0
    ? translation.y * (nextFrame.height / previousFrame.height)
    : 0;

  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

export function pageIndexFromOffset(
  offsetX: number,
  pageWidth: number,
  itemCount: number,
): number {
  if (
    !Number.isFinite(offsetX) ||
    !Number.isFinite(pageWidth) || pageWidth <= 0 ||
    !Number.isFinite(itemCount) || itemCount <= 0
  ) return 0;

  const availableItems = Math.floor(itemCount);
  if (availableItems <= 0) return 0;

  const roundedIndex = Math.round(offsetX / pageWidth);
  if (!Number.isFinite(roundedIndex)) return 0;
  return Math.min(availableItems - 1, Math.max(0, roundedIndex));
}
