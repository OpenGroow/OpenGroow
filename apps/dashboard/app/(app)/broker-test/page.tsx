"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

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
      <Card className="p-5">
        <h1 className="mb-2 text-2xl font-semibold text-foreground">
          Broker Test
        </h1>
        <p className="text-muted-foreground">Convex → Broker → OpenClaw, puis Event → Broker → Convex.</p>
        <div className="mt-3 flex flex-wrap gap-2.5">
          <Badge>
            instanceId: {instanceId}
          </Badge>
          <Badge>
            events: {events?.events?.length ?? 0}
          </Badge>
        </div>
      </Card>

      <section className="mt-4 grid gap-3 md:grid-cols-2">
        <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-3 text-base font-semibold text-foreground">Send Command</h3>
          <div className="grid gap-2.5">
            <label>
              <div className="mb-1 text-sm text-muted-foreground">Project ID</div>
              <Input
                value={instanceId}
                onChange={(event) => setInstanceId(event.target.value)}
                className="w-full"
                placeholder="openclaw-dev-1"
              />
            </label>
            <label>
              <div className="mb-1 text-sm text-muted-foreground">Command Type</div>
              <Input
                value={commandType}
                onChange={(event) => setCommandType(event.target.value)}
                className="w-full"
                placeholder="debug.set_text"
              />
            </label>
            <label>
              <div className="mb-1 text-sm text-muted-foreground">Payload.text</div>
              <Input
                value={payloadText}
                onChange={(event) => setPayloadText(event.target.value)}
                className="w-full"
                placeholder="hello"
              />
            </label>
            <Button
              onClick={handleSend}
            >
              Send
            </Button>
            <Button
              onClick={handleSimulateAction}
            >
              Simulate Update
            </Button>
            {status ? <div className="text-sm text-muted-foreground">{status}</div> : null}
          </div>
        </article>

        <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-3 text-base font-semibold text-foreground">Recent Events</h3>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-border bg-muted p-4 text-xs leading-6 text-foreground">
            {JSON.stringify(events?.events ?? [], null, 2)}
          </pre>
        </article>
      </section>
    </main>
  );
}
