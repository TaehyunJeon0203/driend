export function redirectSystemPath({ path }: { path: string }): string {
  const clean = path.replace(/^\/+/, '');
  if (clean === 'start-drive' || clean === 'stop-drive') {
    return '/(tabs)';
  }
  return path;
}
