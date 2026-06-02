# Revenants — Validation Plan

## Goal

Confirm Revenants plugin is an adequate replacement for current cron setup before public deployment.

## Test Categories

### 1. Data Parity

Compare plugin outputs against current cron outputs:
- **Trace collection:** Same types, same metadata, no data loss
- **Boredom calculation:** Same formula, same triggers, no gaps
- **Stability monitoring:** Same metrics, same alerts, no delays
- **ArXiv detection:** Same papers, same timing, no misses
- **Cron health:** Same failures detected, same alerts

### 2. Token Efficiency

Measure token reduction on routine work:
- **Baseline:** Current cron token cost (estimate)
- **Plugin:** Zero model token cost on data collection
- **Lean payloads:** Agent analysis token cost with pre-processed data
- **Target:** ≥ 60% reduction on routine work

### 3. Timeout Elimination

Measure timeout failure reduction:
- **Baseline:** Current cron timeout rate (8+ failures)
- **Plugin:** Zero timeout failures (scripts run directly)
- **Target:** 0 timeout failures on plugin-driven work

### 4. Model Crash Prevention

Measure crash reduction:
- **Baseline:** Model crashes from cron competition (this is what we're solving)
- **Plugin:** No cron competition (continuous, deterministic)
- **Target:** 0 crashes from cron interruption

### 5. Data Continuity

Measure data gap reduction:
- **Baseline:** 15min/3hr gaps between collection cycles
- **Plugin:** Continuous real-time data
- **Target:** No data gaps

### 6. Agent Payload Quality

Measure lean payload effectiveness:
- **Baseline:** Heavy cron payloads (model parses everything)
- **Plugin:** Pre-processed, agent-friendly payloads
- **Target:** Model adds value to analysis, not parsing

## Validation Process

1. **Phase 1:** Build trace collector + monitor suite
   - Test against current cron outputs
   - Confirm data parity
   - Confirm timeout elimination

2. **Phase 2:** Build lean analysis crons
   - Compare outputs against current cron
   - Confirm adequacy
   - Confirm token reduction

3. **Phase 3:** Full integration
   - Deploy plugin as OpenClaw plugin
   - Switch cron jobs to plugin-driven
   - Validate full system operation
   - Confirm no regressions

4. **Phase 4:** Public release (if validated)
   - Add to GitHub
   - Document for community
   - Update Remnant-Research

## Success Criteria

All criteria must pass before public release:
- [ ] Data parity confirmed (no data loss)
- [ ] Token reduction ≥ 60%
- [ ] Timeout failures = 0
- [ ] Model crashes = 0
- [ ] Data continuity confirmed (no gaps)
- [ ] Agent payload quality confirmed (lean, effective)
- [ ] Full system operation validated (no regressions)

---

*Validation results will determine public release timing.*
