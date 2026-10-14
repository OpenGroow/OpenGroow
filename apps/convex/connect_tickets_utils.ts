export const NO_EXPIRY_SENTINEL = 0;
const FAR_FUTURE_MS = 9_999_999_999_999;

export function computeConnectTicketExpiresAt(
  createdAt: number,
  ttlMs: number,
): number {
  if (ttlMs === 0) return NO_EXPIRY_SENTINEL;
  return createdAt + ttlMs;
}

export function buildPublicExpiresAt(expiresAt: number): string {
  return new Date(expiresAt === NO_EXPIRY_SENTINEL ? FAR_FUTURE_MS : expiresAt).toISOString();
}

export function isConnectTicketExpired(expiresAt: number, now: number): boolean {
  if (expiresAt === NO_EXPIRY_SENTINEL) return false;
  return expiresAt <= now;
}
