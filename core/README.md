# Revenants Core

Plugin core infrastructure for OpenClaw gateway integration.

## Files

- `plugin-config.yaml` — Plugin configuration
- `gateway-integration.js` — Gateway event hooks and lifecycle
- `data-store.js` — Local data storage (JSON files)
- `trace-normalizer.js` — Trace format standardization
- `broadcast-engine.js` — State broadcasting to agent sessions

## Design

The plugin runs as a continuous OpenClaw plugin:
- Lifecycle hooks: init, shutdown, restart
- Gateway event hooks: session events, cron events, tool calls
- Data store: local JSON files (structured, agent-friendly)
- Broadcast: deterministic state updates to agent sessions

## OpenClaw Plugin Integration

Plugin registration via OpenClaw plugin system:
- `clawhub install revenants` (when ready for public)
- Manual plugin file placement (during silent build)
- Gateway config update to activate

## Data Format

All data stored in structured JSON files:
- Consistent with current Remnant-Research format
- Agent-friendly (lean payloads for analysis)
- Pre-processed where possible

---

*Build in progress.*
