let pendingStartDrive = false;
let pendingStopDrive = false;

export function markPendingWidgetStartDrive(): void {
  pendingStartDrive = true;
}

export function consumePendingWidgetStartDrive(): boolean {
  if (!pendingStartDrive) return false;
  pendingStartDrive = false;
  return true;
}

export function markPendingWidgetStopDrive(): void {
  pendingStopDrive = true;
}

export function consumePendingWidgetStopDrive(): boolean {
  if (!pendingStopDrive) return false;
  pendingStopDrive = false;
  return true;
}
