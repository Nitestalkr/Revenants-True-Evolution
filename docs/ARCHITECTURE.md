# Revenants - Architecture Design

## Problem Statement

Current cron-heavy setup causes:
- **Token waste:** 14+ cron jobs each sending heavy payloads to model every cycle
- **Timeout failures:** 600s timeouts on routine work that should be instant
- **Bursty data:** 15min/3hr gaps between collection cycles — missing intermediate state
- **Model crashes:** Cron interruptions mid-task (this is what we're solving)
- **Competition:** Multiple cron jobs fighting for the same model processing window

## Solution: Plugin-Native Architecture

Revenants inherits the GNW/GRAO research loop, but not the cron execution model.
The target architecture is plugin-native: OpenClaw gateway hooks, monitor events,
trace normalization, physics-gated proposals, and LibraVDB-boundary promotion
signals. Cron-era materials are provenance and comparison evidence only.

### Layer 1: Continuous Data Collection (Plugin)

**What:** Traces, metrics, monitoring, paper detection
**How:** Runs in OpenClaw gateway continuously, no model dependency
**Benefit:** Zero token cost, no timeouts, real-time data, no cron competition

### Layer 2: Lean Analysis (Agent Turns)

**What:** Gradients, proposals, drive computation, decisions
**How:** Agent turns with pre-processed data from plugin
**Benefit:** Model adds value to analysis, lean payloads (no raw trace parsing)

### Layer 3: Physics-Gated Promotion

**What:** Advisory drive pressure, promotion proposals, handoff summaries
**How:** Plugin queues or applies distilled signals after pressure and
conservation checks
**Benefit:** Deterministic evidence flow with autonomous application bounded by
explicit target allow-lists and conservation rules

## Architecture Diagram

```
[OpenClaw Gateway]
    │
    ├── Revenants Plugin (continuous)
    │   ├── Trace Collector (real-time)
    │   ├── Monitor Suite (boredom, stability, ArXiv, legacy health)
    │   ├── Promotion Queue (agent-reviewed signals)
    │   └── Data Store (local JSON/SQLite)
    │
    ├── Agent Turns (model-dependent, lean payloads)
    │   ├── GRAO Analysis (gradients, proposals)
    │   ├── GNW Drive Pressure Review
    │   └── Research Analysis
    │
    └── LibraVDB Boundary
        ├── Memory/context authority remains LibraVDB
        ├── Revenants queues distilled promotion signals
        └── No direct memory or policy mutation
```

## Key Components

### Trace Collector

Replaces: GNW cron trace collection, GRAO trace collection
- Captures all tool calls, exec outputs, session events
- Normalizes into trace format (type, timestamp, metadata)
- Stores in local data store
- No model parsing required

### Monitor Suite

Replaces: Stability Monitor, Boredom Scan, ArXiv Monitor, Cron Health Monitor
- **Boredom monitor:** Continuous calculation, triggers when threshold hit
- **Stability monitor:** Memory, CPU, drive health, gateway/runtime status
- **ArXiv monitor:** Real-time paper detection, auto-download
- **Legacy scheduler health monitor:** Tracks source-era scheduler failures only
  when needed for migration diagnostics. It is not part of the target loop.

### Promotion Queue and Autonomous Approval

Replaces: GNW Phase 6 sync crons, cluster weight sync, automatic proposal
delivery
- Queues advisory drive pressure and promotion candidates
- Applies pressure/conservation-passed runtime/config, implementation-task, or
  research-review candidates automatically when `autonomousApprovals` is enabled
- Leaves conservation-blocked candidates and sensitive document targets queued
  for inspection instead of applying across boundaries
- LibraVDB remains the memory/context authority
- Deterministic evidence flow, no model dependency for raw collection

### Data Store

- Local runtime files for traces, state, and promotion queues
- Structured for auditability and agent consumption
- Pre-processed for lean payloads
- Excluded from the repository unless explicit owner approval allows a small fixture

## Migration Path

### Phase 1: Trace Collector + Monitor Suite
- Build plugin core
- Implement trace collector
- Implement monitoring suite
- Test against current cron outputs

### Phase 2: Agent-Reviewed Analysis
- Replace GRAO analysis cron with plugin-provided trace summaries
- Replace GNW drive cron with advisory drive-pressure summaries
- Verify outputs match

## Research Landing Map

Recent paper-derived work should extend the existing plugin-native surfaces rather
than spawn a separate subsystem:

- **GRAM** lands in `plugin/core/observer.js` and
  `plugin/core/trace-normalizer.js`
  to sharpen salience scoring, gradient routing, and proposal shaping.
- **LDT** lands in `plugin/core/observer.js`,
  `plugin/core/data-store.js`, and `plugin/core/promotion-applier.js`
  to govern staged review thresholds, queue escalation, and runtime policy
  follow-up.
- **PTRM** lands in `plugin/monitors/arxiv-monitor.js`,
  `plugin/core/trace-normalizer.js`, and
  `plugin/core/promotion-applier.js`
  to keep research-to-runtime translation explicit, reviewable, and tied to
  concrete landing zones.

Research-origin proposals should surface these landing zones in queue metadata so
the physics gate can decide whether a paper belongs in runtime config, an
implementation task, or supporting guidance.

### Phase 3: Integration
- Deploy plugin as OpenClaw plugin
- Remove cron dependency from the target Revenants path
- Validate full system operation
- Confirm adequacy as replacement

### Phase 4: Public Release (if validated)
- Add to GitHub
- Document for community
- Update Remnant-Research

## Success Criteria

- **Zero model token cost** on data collection
- **Zero timeout failures** on monitoring
- **Continuous data** (no periodic gaps)
- **No model crashes** from cron competition
- **Output parity** with current cron-derived theory (or better)
- **Token reduction** ≥ 60% on routine work
- **No autonomous memory/policy mutation** unless separately opted into the
  autonomous approval target allow-list

---

*Architecture subject to refinement during build.*
