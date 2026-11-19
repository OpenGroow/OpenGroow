// A test adapter of contract 2 (ADR-079): answers a recorded reading, with a derived figure and a stray key
// that the core must not store.
export default {
  id: "demo-metrics",
  name: "Demo metrics",
  contractVersion: 2,
  needs: "url",
  earliestDelayMs: 259_200_000,
  async read() {
    return { ok: true, reading: { status: "taken", metrics: { clicks: 46, impressions: 1900, ctr: 0.024, position: 11.8, stray: 1 } } };
  },
};
