let pendingStartDrive = false;

export function markPendingWidgetStartDrive(): void {
  pendingStartDrive = true;
}

export function consumePendingWidgetStartDrive(): boolean {
  if (!pendingStartDrive) return false;
  pendingStartDrive = false;
  return true;
}
