/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BrandPage from "../app/(app)/projects/[projectId]/brand/page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refreshVersionMock = vi.fn();
const upsertBrandCoreMock = vi.fn();
const useActionMock = vi.fn();
const useMutationMock = vi.fn();
const useQueryMock = vi.fn();
const useAuthenticatedInstancesMock = vi.fn();
const pushMock = vi.fn();
const savedBrandCore = {
  instanceId: "project-1",
  audience: "Founders and marketers",
  tone: "Warm and direct",
  offer: "Automation workflows",
  positioning: "The practical agent platform",
  editorialRules: "Prefer concrete examples",
  constraints: "No unsupported metrics",
  avoid: "Buzzwords",
  notes: "Seasonality matters",
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("convex/react", () => ({
  useAction: (...args: unknown[]) => useActionMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    brand_cores: {
      get: "brand_cores.get",
      upsert: "brand_cores.upsert",
    },
    runtime_commands_node: {
      refreshOpenClawVersion: "runtime_commands_node.refreshOpenClawVersion",
    },
  },
}));

vi.mock("@/src/hooks/use-authenticated-instances", () => ({
  useAuthenticatedInstances: () => useAuthenticatedInstancesMock(),
}));

function getRequiredTextarea(labelText: string): HTMLTextAreaElement {
  const editButton = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Edit");
  if (editButton) {
    act(() => {
      editButton.click();
    });
  }
  const labels = Array.from(document.querySelectorAll("label"));
  const label = labels.find((candidate) => candidate.textContent?.trim() === labelText);
  if (!(label instanceof HTMLLabelElement)) {
    throw new Error(`Label not found: ${labelText}`);
  }

  const control = label.htmlFor ? document.getElementById(label.htmlFor) : null;
  if (control instanceof HTMLTextAreaElement) {
    return control;
  }

  throw new Error(`Textarea not found for label: ${labelText}`);
}

async function typeInto(control: HTMLTextAreaElement, value: string) {
  await act(async () => {
    control.focus();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    descriptor?.set?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("Project overview Brand Core form", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    refreshVersionMock.mockReset();
    upsertBrandCoreMock.mockReset();
    pushMock.mockReset();

    useActionMock.mockImplementation((key: string) => {
      if (key === "runtime_commands_node.refreshOpenClawVersion") {
        return refreshVersionMock;
      }
      return vi.fn();
    });
    useMutationMock.mockImplementation((key: string) => {
      if (key === "brand_cores.upsert") {
        return upsertBrandCoreMock;
      }
      return vi.fn();
    });
    useQueryMock.mockImplementation((key: string) => {
      if (key === "brand_cores.get") {
        return savedBrandCore;
      }
      return undefined;
    });
    useAuthenticatedInstancesMock.mockReturnValue([
      {
        jobId: "job-1",
        status: "running",
        runtimeStatus: "linked",
        runtimeReady: true,
        openclawId: "project-1",
        openclawName: "Project One",
        authProvider: { linked: true },
        whatsAppChannel: { linked: true },
      },
    ]);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = "";
  });

  async function render() {
    await act(async () => {
      root.render(
        <BrandPage params={Promise.resolve({ projectId: "project-1" })} />,
      );
    });
  }

  it("prefills all Brand Core rubrics and saves partial edits", async () => {
    await render();

    expect(getRequiredTextarea("Audience").value).toBe("Founders and marketers");
    expect(getRequiredTextarea("Tone of voice").value).toBe("Warm and direct");
    expect(getRequiredTextarea("Offer").value).toBe("Automation workflows");
    expect(getRequiredTextarea("Positioning").value).toBe("The practical agent platform");
    expect(getRequiredTextarea("Editorial rules").value).toBe("Prefer concrete examples");
    expect(getRequiredTextarea("Constraints").value).toBe("No unsupported metrics");
    expect(getRequiredTextarea("Things to avoid").value).toBe("Buzzwords");
    expect(getRequiredTextarea("Additional notes").value).toBe("Seasonality matters");

    await typeInto(getRequiredTextarea("Audience"), "Independent shop owners");
    await typeInto(getRequiredTextarea("Tone of voice"), "");
    await typeInto(getRequiredTextarea("Offer"), "Done-for-you workflows");
    await typeInto(getRequiredTextarea("Things to avoid"), "");
    const form = getRequiredTextarea("Audience").closest("form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Brand Core form not found");
    }

    await submit(form);

    expect(upsertBrandCoreMock).toHaveBeenCalledWith({
      instanceId: "project-1",
      audience: "Independent shop owners",
      tone: "",
      offer: "Done-for-you workflows",
      positioning: "The practical agent platform",
      editorialRules: "Prefer concrete examples",
      constraints: "No unsupported metrics",
      avoid: "",
      notes: "Seasonality matters",
    });
  });
});
