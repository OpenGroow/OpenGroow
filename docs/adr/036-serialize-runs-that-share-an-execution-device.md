# ADR-036: Serialize Runs that share an Execution device

**Status:** Accepted

Several Agents may use the same Execution device, but device-dependent Runs must never control it concurrently because account selection and the foreground application are global device state. A Run that cannot acquire its device remains `pending` and is presented as "Waiting for device"; it is not failed, cancelled, or made to sleep inside the Agent. The dispatcher claims it only after the currently active Run releases the device, preserving the normal Run lifecycle and preventing two Agents from changing Instagram accounts underneath each other.

**Implementation note (2026-08-06):** `instanceId` identifies an OpenClaw runtime,
not the physical paired node. The Social Engagement template currently targets the
paired node by the display label `"My Computer"`; the stable node identity is
resolved inside each OpenClaw gateway but is not yet carried on a Convex `Run`.
Consequently, the dispatcher applies a template-level lock for
`social-engagement` across `instanceId`s, using the
`by_template_status_created` index and the active states
`dispatching`/`running`/`awaiting_job`. This is intentionally scoped to Social
Engagement because its account selection and foreground Instagram state are
shared on the phone; unrelated mission templates remain independently
dispatchable. A future generic device lock should persist the resolved paired
node identity on the Run and lock directly on that identity.
