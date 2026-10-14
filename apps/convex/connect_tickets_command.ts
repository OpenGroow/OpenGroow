export function buildNodeRunCommand(input: {
  gatewayToken: string;
  relayUrl: string;
  instanceId: string;
  displayName?: string;
}): string {
  return [
    `OPENCLAW_GATEWAY_TOKEN=${shellQuote(input.gatewayToken)}`,
    "pnpm openclaw-connect:node-run --",
    `--relay-url ${shellQuote(input.relayUrl)}`,
    `--state-key ${shellQuote(input.instanceId)}`,
    `--display-name ${shellQuote(input.displayName ?? "My Computer")}`,
  ]
    .filter((part) => part.length > 0)
    .join(" ");
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9._:@/+%-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}
