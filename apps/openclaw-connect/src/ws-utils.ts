export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function parseRawProtocols(raw: string | string[] | undefined): string[] {
  const joined = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  return joined
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function truncateCloseReason(reason: string): string {
  return reason.length <= 120 ? reason : `${reason.slice(0, 117)}...`;
}

export function normalizeWebSocketCloseCode(code: number | undefined): number {
  if (
    code !== undefined &&
    ((code >= 1000 &&
      code <= 1014 &&
      ![1004, 1005, 1006].includes(code)) ||
      (code >= 3000 && code <= 4999))
  ) {
    return code;
  }
  return 1011;
}

export function isPairingRequiredCloseReason(reason: string | undefined): boolean {
  return /pairing required|scope upgrade pending approval/i.test(reason ?? "");
}
