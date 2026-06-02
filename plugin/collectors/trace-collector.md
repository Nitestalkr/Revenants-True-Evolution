# Trace Collector — Design

## Purpose

Replace the periodic GNW/GRAO trace collection with continuous real-time capture.

## Current Pain

- GNW cron collects traces every 3hr → gaps between cycles
- GRAO cron collects traces periodically → missing intermediate state
- Model has to parse the entire cron payload → token waste
- Cron jobs compete → timeout failures

## Plugin Solution

### Collection Methods

**Tool call capture:**
- All `exec`, `browser`, `read`, `write`, `edit`, `web_fetch`, etc.
- Timestamp, tool name, input, output, duration
- Stored as normalized trace

**Session events:**
- Session start/end, spawn events, completion events
- Agent status changes, cron execution status
- Model crashes, timeouts (flagged as anomalies)

**System state:**
- Memory usage, drive health, cron status
- Gateway events, plugin state changes
- Continuous monitoring (no periodic snapshots)

### Trace Format

```json
{
  "type": "tool_call|session_event|system_state|anomaly",
  "timestamp": "2026-05-17T19:10:00Z",
  "source": "agent_id|cron_job|system",
  "metadata": {
    "tool": "exec",
    "command": "...",
    "output": "...",
    "duration_ms": 1234,
    "status": "success|timeout|error"
  }
}
```

### Storage

- Local JSON files in `revenants/data/`
- Structured by type and date
- Agent-friendly format (pre-processed where possible)
- No model dependency for storage

### Processing

- Normalization runs in plugin (no model parsing)
- Deduplication (same tool call → single trace)
- Classification (agent, research, stability, experience)
- Pre-aggregation for lean agent payloads

## Agent Payload Design

Instead of sending raw traces to agent turns:
- Plugin sends pre-aggregated summaries
- Agent receives: "12 tool calls, 3 timeouts, 2 anomalies"
- Agent processes analysis, not parsing
- Token cost reduced by ~70%

## Validation

Compare against current cron outputs:
- Same trace types captured
- Same metadata fields
- Same classification
- No data loss during transition

---

*Implementation pending.*
