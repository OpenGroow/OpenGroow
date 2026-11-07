# Postiz reference (test fixture)

A copy of the Postiz plugin from the hub (`groowhub/packages/publisher/postiz`),
used only by the core's tests: they exercise the Publication flows (retry,
scheduling, reconciliation) through a real plugin against a faked Postiz API.
It is not a workspace package and is never shipped. Update it from the hub when
the plugin's behaviour changes; the plugin's own tests live in the hub.
