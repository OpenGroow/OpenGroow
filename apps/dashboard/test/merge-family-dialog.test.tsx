import { describe, expect, it, vi } from "vitest";
import { runMerge } from "../src/components/merge-family-dialog";

describe("runMerge", () => {
  it("repeats the call until nothing remains and totals the Sources moved", async () => {
    const step = vi
      .fn()
      .mockResolvedValueOnce({ moved: 100, remaining: 100 })
      .mockResolvedValueOnce({ moved: 100, remaining: 30 })
      .mockResolvedValueOnce({ moved: 30, remaining: 0 });
    expect(await runMerge(step)).toBe(230);
    expect(step).toHaveBeenCalledTimes(3);
  });

  it("stops at the first failure so the user can run it again", async () => {
    const step = vi.fn().mockResolvedValueOnce({ moved: 100, remaining: 5 }).mockRejectedValueOnce(new Error("boom"));
    await expect(runMerge(step)).rejects.toThrow("boom");
    expect(step).toHaveBeenCalledTimes(2);
  });
});
