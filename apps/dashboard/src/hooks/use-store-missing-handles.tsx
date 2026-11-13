"use client";

import { useEffect, useRef } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

type Publisher = FunctionReturnType<typeof api.publishers.list>[number] | null;
type LiveChannel = { id: string; profile?: string };

/**
 * Channels added before handles were kept have none stored. Stores each missing
 * handle (one batched write) from the Publisher's live channel list, so every view shows
 * the real @handle without a visit to the Publishers page.
 *
 * `channels` is the live list when the caller already has it (the Publishers
 * page); `undefined` makes the hook ask Postiz once itself; `null` means the
 * caller is still loading it.
 */
export function useStoreMissingHandles(
  instanceId: string,
  publisher: Publisher | undefined,
  channels?: LiveChannel[] | null,
) {
  const listChannels = useAction(api.publishers_node.listChannels);
  const setChannelProfiles = useMutation(api.publishers.setChannelProfiles);
  const needed = Boolean(publisher?.hasApiKey && publisher.targets.some((t) => t.mapped && !t.channelProfile));
  const listed = useRef(false);
  const stored = useRef(new Set<string>());

  useEffect(() => {
    if (!needed || !publisher || channels === null) return;
    void (async () => {
      try {
        let live = channels;
        if (live === undefined) {
          if (listed.current) return;
          listed.current = true;
          const result = await listChannels({ instanceId, adapter: publisher.adapter });
          if (!result.ok) return;
          live = result.channels;
        }
        const profiles = publisher.targets.flatMap((t) => {
          if (!t.mapped || t.channelProfile || stored.current.has(t.target)) return [];
          const profile = live.find((c) => c.id === t.channelId)?.profile;
          return profile ? [{ target: t.target, channelProfile: profile }] : [];
        });
        if (profiles.length === 0) return;
        for (const p of profiles) stored.current.add(p.target);
        await setChannelProfiles({ instanceId, adapter: publisher.adapter, profiles });
      } catch {
        // Best effort: the views keep showing the channel names.
      }
    })();
  }, [needed, publisher, channels, instanceId, listChannels, setChannelProfiles]);
}

/** The same, for each of the Project's Publishers (a hook cannot run in a loop). */
export function StoreMissingHandles({ instanceId, publishers }: { instanceId: string; publishers: readonly NonNullable<Publisher>[] | undefined }) {
  return (
    <>
      {(publishers ?? []).map((publisher) => (
        <StoreMissingHandlesOf key={publisher.adapter} instanceId={instanceId} publisher={publisher} />
      ))}
    </>
  );
}

function StoreMissingHandlesOf({ instanceId, publisher }: { instanceId: string; publisher: NonNullable<Publisher> }) {
  useStoreMissingHandles(instanceId, publisher);
  return null;
}
