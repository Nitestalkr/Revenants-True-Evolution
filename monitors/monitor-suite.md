# Monitor Suite — Design

## Purpose

Replace the current periodic cron-based monitoring with continuous monitoring.

## Current Cron Monitors

| Cron Job | Interval | Status | Problem |
|----------|----------|--------|---------|
| GNW Boredom Scan | 15min | ⚠️ Error | Timeout failures, bursty data |
| GNW Cognitive Cycle | 3hr | ⚠️ Error | Timeout failures, model parsing |
| Stability Monitor | Periodic | ⚠️ Error | Interrupted, periodic snapshots |
| ArXiv Research Monitor | Periodic | ⚠️ Error | Interrupted, bursty paper detection |
| Daily Health Check | Daily | ✅ Running | OK, but periodic |
| TPG-GRAO AutoEvolution | Periodic | ⚠️ Error | Timeout failures |
| Cron Health Monitor | Periodic | ⚠️ Error | Interrupted |

## Plugin Replacement

### Continuous Monitors

**Boredom Monitor:**
- Continuous calculation of boredom formula
- Triggers cognitive cycle when threshold hit (≥ 0.50)
- Suppressed when user active (floor at 0.30)
- No 15min interval gaps

**Stability Monitor:**
- Continuous memory usage tracking
- Drive health monitoring (oscillation detection)
- Cron health monitoring (failure detection)
- Real-time alerts (no periodic snapshots)

**ArXiv Monitor:**
- Real-time paper detection on arXiv
- Auto-download top picks
- Keyword monitoring (continuous)
- No scheduled fetch gaps

**Cron Health Monitor:**
- Tracks all cron execution in real-time
- Flags failures immediately (no periodic check)
- Timeout detection, interruption tracking
- Auto-recovery suggestions

**System Health Monitor:**
- Memory, CPU, drive usage
- Gateway status, plugin health
- Agent status tracking
- Continuous monitoring

## Data Output

Monitors output to:
- Local JSON files (structured)
- Broadcast to agent sessions (lean payloads)
- Alert triggers (immediate notification)
- Historical data (for analysis)

## Migration

1. Build each monitor as plugin component
2. Test against current cron outputs
3. Confirm adequacy (same data, better delivery)
4. Switch over cron jobs
5. Validate full system operation

---

*Implementation pending.*
