import { describe, expect, it, vi } from 'vitest';
import { createStopCoordinator } from './stopCoordinator';

describe('createStopCoordinator', () => {
  it('shares one promise and captures the first stopping drive ID', async () => {
    // Given
    let releaseStop = (): void => {};
    const runStop = vi.fn(async (driveId: string | null) => {
      await new Promise<void>((resolve) => {
        releaseStop = resolve;
      });
      return driveId;
    });
    const coordinator = createStopCoordinator(runStop);

    // When
    const first = coordinator.stop('drive-a');
    const concurrent = coordinator.stop('drive-b');
    releaseStop();

    // Then
    expect(concurrent).toBe(first);
    await expect(first).resolves.toBe('drive-a');
    expect(runStop).toHaveBeenCalledOnce();
    expect(runStop).toHaveBeenCalledWith('drive-a');
  });

  it('allows the same drive to retry after a failed stop', async () => {
    // Given
    const failure = new Error('route flush failed');
    const runStop = vi.fn<(_driveId: string | null) => Promise<string | null>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce('drive-a');
    const coordinator = createStopCoordinator(runStop);

    // When / Then
    await expect(coordinator.stop('drive-a')).rejects.toBe(failure);
    await expect(coordinator.stop('drive-a')).resolves.toBe('drive-a');
    expect(runStop).toHaveBeenCalledTimes(2);
  });
});
