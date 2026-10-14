import os from "node:os";
import path from "node:path";

/** Root of the paired node's OpenClaw state, under the user's home directory. */
export const STATE_ROOT_NAME = ".openclaw-opengroow-connect";

export function resolveStateRoot(home: string = os.homedir()): string {
  return path.join(home, STATE_ROOT_NAME);
}
