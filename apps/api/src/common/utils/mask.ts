/**
 * Mask a PII value, keeping the last `visible` characters: '80010112345' with
 * two visible becomes '•••••••••45'. Length is preserved: the masked form is
 * a recognition aid ("is this the right person?"), not a secret, and knowing a
 * national identifier's length reveals nothing.
 */
export function maskTail(value: string, visible: number): string {
  if (visible <= 0) return '•'.repeat(value.length);
  if (value.length <= visible) return '•'.repeat(value.length);
  return '•'.repeat(value.length - visible) + value.slice(-visible);
}
