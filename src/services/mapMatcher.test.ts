import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { matchRoute, mergeMatchedChunks, type LngLat } from './mapMatcher';

const longRoute = Array.from({ length: 101 }, (_, index): LngLat => [127 + index * 0.00001, 37.5]);

describe('chunked map matching', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null instead of saving a partial route when any chunk fails', async () => {
    const matcher = vi.fn()
      .mockResolvedValueOnce([[127, 37.5], [127.001, 37.5]])
      .mockResolvedValueOnce(null);

    await expect(matchRoute(longRoute, matcher)).resolves.toBeNull();
    expect(matcher).toHaveBeenCalledTimes(2);
  });

  it('returns null when adjacent matched chunks cannot be merged', async () => {
    const matcher = vi.fn()
      .mockResolvedValueOnce([[127, 37.5], [127.001, 37.5]])
      .mockResolvedValueOnce([[128, 38], [128.001, 38]]);

    await expect(matchRoute(longRoute, matcher)).resolves.toBeNull();
  });

  it('merges at the nearest ordered seam without retaining duplicate overlap', () => {
    expect(mergeMatchedChunks(
      [[127, 37.5], [127.001, 37.5], [127.002, 37.5]],
      [[127.001, 37.5], [127.002, 37.5], [127.003, 37.5]],
    )).toEqual([[127, 37.5], [127.001, 37.5], [127.002, 37.5], [127.003, 37.5]]);
  });
});
