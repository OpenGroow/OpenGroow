export const PROTOCOL_VERSION = 1 as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

export type InstanceJobStatus = "queued" | "running" | "succeeded" | "failed";
export type RuntimeStatus = "provisioning" | "starting" | "created" | "linked" | "failed";
export type CommandStatus = "queued" | "sent" | "failed";
