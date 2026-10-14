"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api.js";

export default function BrokerTestPage() {
  const [instanceId, setInstanceId] = useState("openclaw-dev-1");
  const [commandType, setCommandType] = useState("debug.set_text");
  const [payloadText, setPayloadText] = useState("hello");
  const [status, setStatus] = useState<string | null>(null);

  const enqueue = useMutation(api.commands.enqueue);
  const queryArgs = useMemo(
    () => ({
      limit: 20,
      instanceId: instanceId.trim() ? instanceId.trim() : undefined
    }),
    [instanceId]
  );
  const events = useQuery(api.events.listRecent, queryArgs);

  async function handleSend() {
    setStatus("sending...");
    try {
      const response = await enqueue({
        instanceId: instanceId.trim(),
        type: commandType.trim(),
        payload: { text: payloadText }
      });
      setStatus(`queued: ${response.commandId}`);
    } catch (error) {
      setStatus(`error: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  async function handleSimulateAction() {
    setStatus("sending simulated action...");
    try {
      const response = await enqueue({
        instanceId: instanceId.trim(),
        type: "debug.update_state",
        payload: {
          field: "status",
          value: payloadText,
          ts: Date.now()
        }
      });
      setStatus(`queued: ${response.commandId}`);
    } catch (error) {
      setStatus(`error: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  return (
    <main className="mx-auto my-9 w-[min(1000px,92vw)]">
      <section className="rounded-[20px] border border-stone-200 bg-white/90 p-5 shadow-[0_18px_36px_rgba(24,32,28,0.08)] backdrop-blur">
        <h1 className="mb-2 text-[clamp(1.5rem,3vw,2rem)] font-semibold text-stone-900">
          Broker Test
        </h1>
        <p className="text-stone-600">Convex → Broker → OpenClaw, puis Event → Broker → Convex.</p>
        <div className="mt-3 flex flex-wrap gap-2.5">
          <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm text-stone-700 shadow-sm">
            instanceId: {instanceId}
          </span>
          <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm text-stone-700 shadow-sm">
            events: {events?.events?.length ?? 0}
          </span>
        </div>
      </section>

      <section className="mt-4 grid gap-3 md:grid-cols-2">
        <article className="rounded-2xl border border-stone-200 bg-white/80 p-4 shadow-sm">
          <h3 className="mb-3 text-base font-semibold text-stone-900">Send Command</h3>
          <div className="grid gap-2.5">
            <label>
              <div className="mb-1 text-sm text-stone-500">Project ID</div>
              <input
                value={instanceId}
                onChange={(event) => setInstanceId(event.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                placeholder="openclaw-dev-1"
              />
            </label>
            <label>
              <div className="mb-1 text-sm text-stone-500">Command Type</div>
              <input
                value={commandType}
                onChange={(event) => setCommandType(event.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                placeholder="debug.set_text"
              />
            </label>
            <label>
              <div className="mb-1 text-sm text-stone-500">Payload.text</div>
              <input
                value={payloadText}
                onChange={(event) => setPayloadText(event.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                placeholder="hello"
              />
            </label>
            <button
              onClick={handleSend}
              className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
            >
              Send
            </button>
            <button
              onClick={handleSimulateAction}
              className="rounded-xl bg-teal-800 px-3 py-2 text-sm font-semibold text-white transition hover:bg-teal-900"
            >
              Simulate Update
            </button>
            {status ? <div className="text-sm text-stone-500">{status}</div> : null}
          </div>
        </article>

        <article className="rounded-2xl border border-stone-200 bg-white/80 p-4 shadow-sm">
          <h3 className="mb-3 text-base font-semibold text-stone-900">Recent Events</h3>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl border border-stone-200 bg-stone-50 p-4 text-xs leading-6 text-stone-700">
            {JSON.stringify(events?.events ?? [], null, 2)}
          </pre>
        </article>
      </section>
    </main>
  );
}
