/** Returns an email address that is unique for every call. */
export function uniqueEmail(prefix = 'qa.auto'): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}.${Date.now()}.${random}@example.com`;
}
