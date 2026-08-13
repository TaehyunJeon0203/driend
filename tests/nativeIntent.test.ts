import { describe, expect, it } from 'vitest';
import { redirectSystemPath } from '../app/+native-intent';

describe('redirectSystemPath', () => {
  it.each([
    '/start-drive',
    'driend://start-drive',
    'driend:///start-drive',
  ])('routes widget start action %s through the marker route', (path) => {
    // When
    const result = redirectSystemPath({ path });

    // Then
    expect(result).toBe('/start-drive');
  });

  it.each([
    '/stop-drive',
    'driend://stop-drive',
    'driend:///stop-drive',
  ])('routes stop action %s through the confirmation route', (path) => {
    // When
    const result = redirectSystemPath({ path });

    // Then
    expect(result).toBe('/stop-drive');
  });

  it.each([
    '/user/123',
    'driend://user/123',
    'https://example.com/start-drive',
    'not a URL',
  ])('preserves unrelated system path %s', (path) => {

    // When
    const result = redirectSystemPath({ path });

    // Then
    expect(result).toBe(path);
  });
});
