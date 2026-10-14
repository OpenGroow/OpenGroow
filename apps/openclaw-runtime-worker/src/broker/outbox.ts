import type { OpenClawToBrokerMessage } from "@opengroow/protocol";

export class MessageOutbox {
  private readonly queue: OpenClawToBrokerMessage[] = [];

  enqueue(message: OpenClawToBrokerMessage): void {
    this.queue.push(message);
  }

  prepend(message: OpenClawToBrokerMessage): void {
    this.queue.unshift(message);
  }

  peek(): OpenClawToBrokerMessage | undefined {
    return this.queue[0];
  }

  shift(): OpenClawToBrokerMessage | undefined {
    return this.queue.shift();
  }

  size(): number {
    return this.queue.length;
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }
}
