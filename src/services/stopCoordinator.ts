export type StopCoordinator = {
  readonly stop: (driveId: string | null) => Promise<string | null>;
};

export function createStopCoordinator(
  runStop: (driveId: string | null) => Promise<string | null>,
): StopCoordinator {
  let stopPromise: Promise<string | null> | null = null;

  return {
    stop(driveId) {
      if (stopPromise) return stopPromise;

      stopPromise = runStop(driveId).finally(() => {
        stopPromise = null;
      });
      return stopPromise;
    },
  };
}
