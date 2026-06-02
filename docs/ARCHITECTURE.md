# Revenants — Architecture Design

## Problem Statement

Current cron-heavy setup causes:
- **Token waste:** 14+ cron jobs each sending heavy payloads to model every cycle
- **Timeout failures:** 600s timeouts on routine work that should be instant
- **Bursty data:** 15min/3hr gaps between collection cycles — missing intermediate state
- **Model crashes:** Cron interruptions mid-task (this is what we're solving)
- **Competition:** Multiple cron jobs fighting for the same model processing window

## Solution: Plugin-Driven Architecture

### Layer 1: Continuous Data Collection (Plugin)

**What:** Traces, metrics, monitoring, paper detection
**How:** Runs in OpenClaw gateway continuously, no model dependency
**Benefit:** Zero token cost, no timeouts, real-time data, no cron competition

### Layer 2: Lean Analysis (Agent Turns)

**What:** Gradients, proposals, drive computation, decisions
**How:** Agent turns with pre-processed data from plugin
**Benefit:** Model adds value to analysis, lean payloads (no raw trace parsing)

### Layer 3: Agent Coordination (Plugin Broadcast)

**What:** Drive weight sync, cluster broadcast, state sharing
**How:** Plugin broadcasts to agent sessions, agents respond with analysis
**Benefit:** Deterministic broadcast, no waiting for agent cycles

## Architecture Diagram

```
[OpenClaw Gateway]
    │
    ├── Revenants Plugin (continuous)
    │   ├── Trace Collector (real-time)
    │   ├── Monitor Suite (boredom, stability, ArXiv, cron health)
    │   ├── State Broadcast (to agent sessions)
    │   └── Data Store (local JSON/SQLite)
    │
    ├── Agent Turns (model-dependent, lean payloads)
    │   ├── GRAO Analysis (gradients, proposals)
    │   ├── GNW Drive Computation
    │   └── Research Analysis
    │
    └── Cron Jobs (minimal, plugin-driven)
        ├── Proposal Generator (reads plugin data)
        ├── Drive Sync (reads plugin data)
        └── Daily Reports (reads plugin data)
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
- **Stability monitor:** Memory, CPU, drive health, cron status
- **ArXiv monitor:** Real-time paper detection, auto-download
- **Cron health monitor:** Tracks cron execution, flags failures

### State Broadcast

Replaces: GNW Phase 6 sync crons, cluster weight sync
- Broadcasts drive weights to agent sessions
- Broadcasts cluster state changes
- Agents respond with analysis/updates
- Deterministic, no model dependency

### Data Store

- Local JSON files (consistent with current setup)
- Structured for easy agent consumption
- Pre-processed for lean payloads

## Migration Path

### Phase 1: Trace Collector + Monitor Suite
- Build plugin core
- Implement trace collector
- Implement monitoring suite
- Test against current cron outputs

### Phase 2: Lean Analysis Crons
- Replace GRAO analysis cron with lean version
- Replace GNW drive cron with lean version
- Verify outputs match

### Phase 3: Integration
- Deploy plugin as OpenClaw plugin
- Switch cron jobs to plugin-driven
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
- **Output parity** with current cron setup (or better)
- **Token reduction** ≥ 60% on routine work

---

*Architecture subject to refinement during build.*
