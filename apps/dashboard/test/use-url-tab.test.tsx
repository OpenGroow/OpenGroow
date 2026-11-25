/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useUrlTab } from "../src/lib/use-url-tab";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock("next/navigation", async () => (await import("./fixtures/url-navigation")).navigationMock({ push: (url) => push(url) }));

function Tabs() {
  const [tab, setTab] = useUrlTab(["sources", "recipes"] as const, "sources");
  return (
    <div>
      <span id="current">{tab}</span>
      <button id="recipes" onClick={() => setTab("recipes")} />
      <button id="sources" onClick={() => setTab("sources")} />
    </div>
  );
}

describe("useUrlTab", () => {
  it("keeps the tab in the URL, and leaves the URL clean on the fallback tab", async () => {
    push.mockClear();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<Tabs />));
    expect(container.querySelector("#current")?.textContent).toBe("sources");
    await act(async () => (container.querySelector("#recipes") as HTMLButtonElement).click());
    expect(push).toHaveBeenLastCalledWith("/test?tab=recipes");
    expect(container.querySelector("#current")?.textContent).toBe("recipes");
    await act(async () => (container.querySelector("#sources") as HTMLButtonElement).click());
    expect(push).toHaveBeenLastCalledWith("/test");
    expect(container.querySelector("#current")?.textContent).toBe("sources");
    await act(async () => root.unmount());
    container.remove();
  });
});
