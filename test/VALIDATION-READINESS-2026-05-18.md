# Revenants Validation Readiness Report

Date: 2026-05-18
Status: Blocked
Scope: GHO-185 validation and integration testing readiness

## Summary

Revenants is not yet in a state that can be validated against the current cron system.

The current cron side has enough baseline evidence to compare against:

- Existing research traces are present in `D:\.openclaw\workspace\research\traces`
- `D:\.openclaw\workspace\research\tpg-openclaw.md` documents repeated timeout and cron-reliability work
- `D:\.openclaw\workspace\research\TOKEN_CONSUMPTION_ANALYSIS.md` documents token-cost concerns that motivate the plugin approach
- `D:\.openclaw\workspace\research\trace-collector\README.md` shows an existing trace-collection prototype and expected trace taxonomy

The Revenants side does not yet have executable plugin assets to measure:

- `D:\.openclaw\workspace-revenants\core\README.md` lists `plugin-config.yaml`, `gateway-integration.js`, `data-store.js`, `trace-normalizer.js`, and `broadcast-engine.js`, but none of those files exist
- `D:\.openclaw\workspace-revenants\collectors\trace-collector.md` is design-only and ends with `Implementation pending.`
- `D:\.openclaw\workspace-revenants\monitors\monitor-suite.md` is design-only and ends with `Implementation pending.`
- The repo currently contains docs only: `README.md`, `core/README.md`, `docs/ARCHITECTURE.md`, `collectors/trace-collector.md`, `monitors/monitor-suite.md`, and `test/VALIDATION-PLAN.md`

## What Was Verified

### Baseline cron evidence exists

- The current research workspace contains 700+ trace files under `D:\.openclaw\workspace\research\traces`
- `tpg-openclaw.md` records timeout-policy iterations and cron reliability observations
- Token-efficiency concerns are documented in `TOKEN_CONSUMPTION_ANALYSIS.md`

### Plugin validation target does not exist yet

- No executable plugin core files are present in `D:\.openclaw\workspace-revenants\core`
- No collector implementation files are present in `D:\.openclaw\workspace-revenants\collectors`
- No monitor implementation files are present in `D:\.openclaw\workspace-revenants\monitors`
- No integration test scripts or runnable validation harness are present in `D:\.openclaw\workspace-revenants\test`

## Impact on GHO-185

The issue asks for:

- Data parity testing
- Token efficiency measurement
- Timeout failure measurement
- Model crash prevention measurement
- Data continuity testing
- Payload-quality testing
- Integration testing after deployment

Those checks require at least one executable plugin path that produces:

- traces
- monitor outputs
- structured data-store outputs
- agent-facing payloads

None of those outputs can be generated from the current Revenants workspace.

## Decision

GHO-185 cannot move forward as an implementation/validation task until Revenants has a minimal executable plugin slice.

Recommended unblock order:

1. Implement a minimal plugin core with local data-store output
2. Implement one collector path that emits normalized traces
3. Implement one monitor path that emits deterministic status output
4. Add a runnable validation harness that compares plugin output to the existing cron baseline
5. Resume GHO-185 once real plugin artifacts exist

## Suggested Minimum Acceptance Gate Before Reopening Validation

- `core/plugin-config.yaml` exists
- `core/gateway-integration.js` exists and can start
- `core/data-store.js` writes structured output
- one collector writes normalized traces
- one monitor writes deterministic health output
- one validation script can compare plugin output to baseline cron artifacts
