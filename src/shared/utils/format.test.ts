import { describe, expect, it } from 'vitest';

import { formatBytes, formatNumber } from './format';

describe('format utils', () => {
  it('formats byte values into human readable sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
  });

  it('formats numbers using en-US locale', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(undefined)).toBe('Unknown');
  });
});
