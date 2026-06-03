# LibraVDB Integration

Revenants is designed to complement LibraVDB, not compete with it.

LibraVDB should remain the memory and context authority:

- Own scoped memory, vector recall, continuity, and compaction.
- Assemble the durable context that reaches the model.
- Decide how memory is stored, searched, ranked, and compacted.

Revenants should act as the evolution layer:

- Observe OpenClaw lifecycle hooks, tool calls, model calls, sessions, and monitor alerts.
- Store raw trace data locally for deterministic auditability.
- Track GNW drive pressure and TPG-GRAO gradients from observed behavior.
- Queue distilled promotion signals that LibraVDB can ingest as durable memory.
- Propose changes; do not silently mutate runtime policy or memory ownership.

Default mode is companion observer mode. In that mode Revenants does not register itself as the context engine, so LibraVDB can own `plugins.slots.contextEngine`.

The optional `registerContextEngine` config is for experiments and isolated tests. Enable it only when intentionally testing Revenants as a context engine or when a future OpenClaw runtime supports context-engine chaining.

Promotion policy:

- Raw traces remain in `data/traces.jsonl`.
- Distilled memory candidates are written to `data/promotions.jsonl`.
- Failures, partial results, and high-impact events are promoted by default.
- A future LibraVDB bridge can drain promotions and write them through LibraVDB's memory API.

This split keeps LibraVDB stable while giving it adaptive, evidence-backed signals from Revenants.
