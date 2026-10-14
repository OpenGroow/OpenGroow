import type { EventMessage } from "@opengroow/protocol";

type InProgressRecord = {
  status: "in_progress";
};

type CompletedRecord = {
  status: "completed";
  resultMessage: EventMessage;
};

export type CommandRegistryRecord = InProgressRecord | CompletedRecord;

export class CommandRegistry {
  private readonly records = new Map<string, CommandRegistryRecord>();

  get(commandId: string): CommandRegistryRecord | undefined {
    return this.records.get(commandId);
  }

  markInProgress(commandId: string): void {
    this.records.set(commandId, { status: "in_progress" });
  }

  markCompleted(commandId: string, resultMessage: EventMessage): void {
    this.records.set(commandId, {
      status: "completed",
      resultMessage,
    });
  }
}
