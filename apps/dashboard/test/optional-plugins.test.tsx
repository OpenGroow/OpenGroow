/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { getOptionalPlugins } from "../src/lib/optional-plugins";
import {
  OptionalPluginsProvider,
  useOptionalPlugin,
} from "../src/components/optional-plugins-provider";
import { PluginUnavailableCard } from "../src/components/plugin-unavailable-card";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const original = process.env.OPENCLAW_OPTIONAL_PLUGINS;
afterEach(() => {
  if (original === undefined) delete process.env.OPENCLAW_OPTIONAL_PLUGINS;
  else process.env.OPENCLAW_OPTIONAL_PLUGINS = original;
});

describe("getOptionalPlugins", () => {
  it("is empty when the variable is unset or blank", () => {
    delete process.env.OPENCLAW_OPTIONAL_PLUGINS;
    expect(getOptionalPlugins()).toEqual([]);
    process.env.OPENCLAW_OPTIONAL_PLUGINS = "  ";
    expect(getOptionalPlugins()).toEqual([]);
  });

  it("splits, trims, lowercases and dedupes", () => {
    process.env.OPENCLAW_OPTIONAL_PLUGINS = " Codex, whatsapp ,codex";
    expect(getOptionalPlugins()).toEqual(["codex", "whatsapp"]);
  });
});

function Probe({ id }: { id: "codex" | "whatsapp" }) {
  return <span>{useOptionalPlugin(id) ? "on" : "off"}</span>;
}

function render(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  act(() => createRoot(container).render(element));
  return container;
}

describe("useOptionalPlugin", () => {
  it("reflects the plugins the provider enables", () => {
    const view = render(
      <OptionalPluginsProvider plugins={["codex"]}>
        <Probe id="codex" />
        <Probe id="whatsapp" />
      </OptionalPluginsProvider>,
    );
    expect(view.textContent).toBe("onoff");
  });

  it("is off without a provider", () => {
    expect(render(<Probe id="codex" />).textContent).toBe("off");
  });
});

describe("PluginUnavailableCard", () => {
  it("names the plugin and the variable to set", () => {
    const view = render(<PluginUnavailableCard icon={null} title="WhatsApp" pluginId="whatsapp" />);
    expect(view.textContent).toContain("WhatsApp");
    expect(view.textContent).toContain("OPENCLAW_OPTIONAL_PLUGINS");
    expect(view.textContent).toContain("whatsapp");
  });
});
