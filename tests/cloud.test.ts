import { describe, expect, it } from 'vitest';
import { resolveConflict, type CloudSave } from '../src/platform/cloud';
import { cmpProgress } from '../src/platform/storage';

function serverSave(progress: string): CloudSave {
  return { version: 3, updatedAt: Date.now(), schemaVersion: 4, progress, blob: 'x' };
}

describe('resolveConflict', () => {
  it('pushes when local progress is greater', () => {
    expect(resolveConflict('2000', serverSave('1000'), cmpProgress)).toBe('push');
  });

  it('adopts when the server progress is greater', () => {
    expect(resolveConflict('1000', serverSave('2000'), cmpProgress)).toBe('adopt');
  });

  it('adopts on a tie (same run)', () => {
    expect(resolveConflict('1500', serverSave('1500'), cmpProgress)).toBe('adopt');
  });

  it('defaults its comparator to cmpProgress', () => {
    expect(resolveConflict('2000', serverSave('1000'))).toBe('push');
    expect(resolveConflict('1000', serverSave('2000'))).toBe('adopt');
  });

  it('compares huge break_eternity-layered progress strings correctly', () => {
    expect(resolveConflict('1e100', serverSave('1e50'))).toBe('push');
    expect(resolveConflict('1e50', serverSave('1e100'))).toBe('adopt');
  });
});
