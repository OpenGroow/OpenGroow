export const RUNTIME_HEALTH_CHECK = "runtime.health.check" as const;
export const RUNTIME_HEALTH_RESULT = "runtime.health.result" as const;

export type RuntimeHealthCheckCommandPayload = {
  commandId?: string;
};

export type RuntimeHealthResultPayload = {
  commandId: string;
  instanceId: string;
  ok: boolean;
  error?: string;
  data: {
    output: string;
  };
};
