import { describe, expect, it } from 'vitest';

import { maskMaybeSensitiveValue, previewValue, safeJsonParse, stableStringify } from './serialization';

describe('serialization utils', () => {
  it('parses JSON strings when possible', () => {
    expect(safeJsonParse('{"ok":true}')).toEqual({ ok: true });
    expect(safeJsonParse('plain-text')).toBe('plain-text');
  });

  it('keeps the raw string when parsing would change it', () => {
    expect(safeJsonParse('7123456789012345678')).toBe('7123456789012345678');
    expect(safeJsonParse('{"id":7123456789012345678}')).toBe('{"id":7123456789012345678}');
    expect(safeJsonParse('1.0')).toBe('1.0');
    expect(safeJsonParse('"abc"')).toBe('"abc"');
    expect(safeJsonParse('42')).toBe(42);
  });

  it('masks known sensitive keys', () => {
    expect(maskMaybeSensitiveValue('authToken', '1234567890', true)).toBe('1234••••7890');
    expect(maskMaybeSensitiveValue('theme', 'dark', true)).toBe('dark');
  });

  it('generates stable sorted JSON output', () => {
    expect(stableStringify({ b: 1, a: 2 }, 0)).toBe('{"a":2,"b":1}');
  });

  it('truncates previews for long values', () => {
    expect(previewValue('x'.repeat(200), 10)).toBe('xxxxxxxxxx…');
  });
});
