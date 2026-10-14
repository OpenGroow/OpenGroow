import { createConvexAdapterFromEnv } from "./convex.js";
import { createBrokerServer } from "./broker.js";
import { loadBrokerEnvFile } from "./env.js";
import { loadConvexKeys } from "./keys.js";

// Fail fast and loud instead of hanging in a half-crashed state: any bug we
// didn't catch locally should exit the process so the container's restart
// policy (and healthcheck) can recover it, rather than leaving a broker that
// stopped accepting connections without ever logging why.
process.on("uncaughtException", (error) => {
  console.error("[broker] uncaughtException", error);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[broker] unhandledRejection", reason);
  process.exit(1);
});

loadBrokerEnvFile();

const convexKeys = loadConvexKeys();
const convexKeyEntries = Object.entries(convexKeys);
const hmacKeyId = convexKeyEntries[0]?.[0];
const hmacSecret = convexKeyEntries[0]?.[1]?.secret;

createBrokerServer({
  convex: createConvexAdapterFromEnv({
    hmacKeyId,
    hmacSecret,
  }),
});
