import { api } from "../_generated/api.js";
import type { FunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel.js";

export const enqueueCommandMutation = api.commands.enqueue as unknown as FunctionReference<
  "mutation",
  "public",
  { instanceId: string; type: string; payload?: unknown },
  { status: number; accepted: boolean; commandId: Id<"commands"> }
>;
