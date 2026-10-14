export type BrokerHealth = {
  ok: boolean;
  service: string;
  convex?: { ok: boolean; service: string };
  error?: string;
};

const BROKER_HEALTH_URL = process.env.BROKER_HEALTH_URL!;

export async function fetchBrokerHealth(): Promise<BrokerHealth> {
  if (!BROKER_HEALTH_URL) {
    return {
      ok: false,
      service: "broker",
      error: "BROKER_HEALTH_URL is not configured",
    };
  }

  try {
    const response = await fetch(BROKER_HEALTH_URL, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text();
    const parsed = text.length ? safeParse(text) : {};
    if (!response.ok) {
      return {
        ok: false,
        service: "broker",
        error: `Broker health failed (${response.status})`,
      };
    }
    return parsed as BrokerHealth;
  } catch (error) {
    return {
      ok: false,
      service: "broker",
      error:
        error instanceof Error ? error.message : "Broker health unavailable",
    };
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}
