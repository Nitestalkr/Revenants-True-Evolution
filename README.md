# Revenants

**Silent build project** — OpenClaw plugin framework for companion observation, trace collection, and reviewed LibraVDB proposal signals.

## Purpose

Move the cron-derived research into a plugin-driven architecture that:
- Collects traces in real-time (no periodic gaps)
- Runs scripts directly (no model token overhead)
- Monitors system state continuously (no timeout failures)
- Broadcasts state changes deterministically (no agent turn waiting)
- Treats cron-era material as historical/source reference, not target runtime

## Design Principle

**Data collection → plugin. Analysis → agent turns.**
- The plugin handles traces, metrics, monitoring, paper detection, and proposal queues
- Agent turns handle gradients, decisions, review, and implementation
- LibraVDB remains the memory/context authority
- Hybrid approach: deterministic work automated, analytical work model-driven

## Status

🔒 **Silent build** — not on GitHub until fully operational and validated as adequate replacement.

## Structure

```
revenants/
├── core/           — Plugin core, gateway integration
├── collectors/     — Trace collectors (GNW, GRAO, stability, ArXiv)
├── monitors/       — Continuous monitors plus optional legacy cron signal review
├── broadcast/      — State broadcasting to agents
├── scripts/        — Supporting scripts (no model dependency)
├── docs/           — Design docs, architecture
└── test/           — Validation tests
```

## Current Plan

1. **Trace-collector plugin** — replaces GNW/GRAO periodic trace collection
2. **Monitoring plugin** — replaces Stability Monitor, Boredom Scan, ArXiv Monitor
3. **Lean analysis turns** — GRAO proposal review, GNW drive computation with pre-processed data
4. **Validation** — compare against current cron outputs, confirm adequacy
5. **Integration** — deploy as OpenClaw plugin, retire cron as the core design

---

*Built silently. Deployed when ready.*
