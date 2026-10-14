export type KnownInstance = {
  id: string;
  port: number;
  keyId: string;
  // Needed to rebuild the broker's OpenClaw-keys registry on every
  // create/remove (issue #307) — the broker authenticates each gateway by
  // this shared secret, keyed by `keyId`.
  secret: string;
  createdAt: string;
};

// In-memory registry of instances this service has created — this issue is
// explicitly "not yet wired into Convex" (issue #305), so port allocation
// and instance lookup are only checked against what this process itself has
// launched, not any persisted store. Resets on process restart.
export class InstanceRegistry {
  private readonly instances = new Map<string, KnownInstance>();

  add(instance: KnownInstance): void {
    this.instances.set(instance.id, instance);
  }

  remove(id: string): boolean {
    return this.instances.delete(id);
  }

  get(id: string): KnownInstance | undefined {
    return this.instances.get(id);
  }

  // Issue #308: the dashboard addresses instances by `serverId`, unmodified
  // — the local backend reuses each instance's allocated gateway port as
  // that serverId (see instance_provisioning/local.ts), so logs/status
  // resolve an instance the same way GET/DELETE by id do, just keyed by
  // port instead.
  findByPort(port: number): KnownInstance | undefined {
    return this.list().find((instance) => instance.port === port);
  }

  list(): KnownInstance[] {
    return Array.from(this.instances.values());
  }

  usedPorts(): Set<number> {
    return new Set(this.list().map((instance) => instance.port));
  }
}
