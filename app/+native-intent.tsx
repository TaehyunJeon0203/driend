export function redirectSystemPath({ path }: { path: string }): string {
  const clean = path.replace(/^driend:\/\/\/?/, '').replace(/^\/+/, '');
  if (clean === 'start-drive') {
    return '/start-drive';
  }
  if (clean === 'stop-drive') {
    return '/stop-drive';
  }
  return path;
}
