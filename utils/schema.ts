import { expect } from '@playwright/test';

type JsonType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

function typeOf(value: unknown): JsonType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as JsonType;
}

/**
 * Checks that every listed field exists and has the given JSON type.
 * A field may allow several types, e.g. ['string', 'null'].
 */
export function expectShape(
  value: Record<string, unknown>,
  shape: Record<string, JsonType | JsonType[]>,
  label = 'object',
): void {
  for (const [field, expected] of Object.entries(shape)) {
    const allowed = Array.isArray(expected) ? expected : [expected];
    expect(value, `${label} has field "${field}"`).toHaveProperty(field);
    expect(allowed, `${label}.${field} type`).toContain(typeOf(value[field]));
  }
}
