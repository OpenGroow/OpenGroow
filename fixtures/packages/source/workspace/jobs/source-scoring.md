# Source scoring Job

Score every Source in the batch from `jobs/<job>/run.md`. Use the Source Agent
Brand Core and the fixed rubric in this file's scoring rules. Do not browse,
call MCP tools, create Missions, or write Sources.

For every listed Source, return one score entry in
`additionalDetails.scores`. Each entry must use the Source's exact `sourceId`
and include `productFit`, `replicability`, `creativeStrength`, and a
`creativeFamily` with a lowercase underscore-separated `slug`, a short `name`,
and a one-sentence `description`. Use only `0`, `0.25`, `0.5`, `0.75`, or `1`.
Return every entry, even when all scores are zero.

When the run file includes feedback, correct only the listed invalid entries
and return the complete retry batch. Valid entries from the previous attempt
have already been persisted and will not appear in the retry batch.
