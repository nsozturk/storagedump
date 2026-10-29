const textEncoder = new TextEncoder();

export function estimateBytes(value: unknown): number {
  try {
    return textEncoder.encode(JSON.stringify(value)).length;
  } catch {
    return textEncoder.encode(String(value)).length;
  }
}

export function previewValue(value: unknown, maxLength = 140): string {
  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    return serialized.length > maxLength ? `${serialized.slice(0, maxLength)}…` : serialized;
  } catch {
    return String(value);
  }
}

export function safeJsonParse(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    // Keep the raw string unless parsing round-trips exactly: big integers
    // (e.g. "7123456789012345678") would otherwise lose precision on export, and a
    // JSON-encoded string ('"abc"') would lose its quotes.
    return typeof parsed !== 'string' && JSON.stringify(parsed) === value ? parsed : value;
  } catch {
    return value;
  }
}

export function maskMaybeSensitiveValue(key: string, value: unknown, enabled: boolean): unknown {
  if (!enabled) {
    return value;
  }

  const normalizedKey = key.toLowerCase();
  const sensitive = ['token', 'secret', 'password', 'session', 'cookie', 'auth'].some((fragment) =>
    normalizedKey.includes(fragment)
  );

  if (!sensitive) {
    return value;
  }

  const original = typeof value === 'string' ? value : JSON.stringify(value);
  if (original.length <= 8) {
    return '••••';
  }

  return `${original.slice(0, 4)}••••${original.slice(-4)}`;
}

export function stableStringify(value: unknown, spacing = 2): string {
  return JSON.stringify(value, (_, nestedValue) => {
    if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
      return Object.fromEntries(Object.entries(nestedValue).sort(([left], [right]) => left.localeCompare(right)));
    }

    return nestedValue;
  }, spacing);
}
