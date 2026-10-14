import {
  buildRuntimeResultEventId,
  type EventMessage,
} from "@opengroow/protocol";

export function createEventMessage(
  type: string,
  commandId: string,
  payload: unknown,
): EventMessage {
  return {
    type: "event",
    event: {
      id: buildRuntimeResultEventId(commandId),
      type,
      payload,
      ts: Date.now(),
    },
  };
}
