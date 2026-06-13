# Revenants True Evolution

Revenants is an OpenClaw companion evolution layer for continuous GNW/GRAO trace
collection, monitor orchestration, and LibraVDB promotion signals.

The project is moving cron-derived research away from a cron-heavy
implementation and toward a plugin-first architecture:

- The plugin observes, collects, normalizes, monitors, and promotes signals.
- LibraVDB remains the memory/context authority.
- Agent turns handle reasoning, proposals, implementation decisions, and
  validation.
- Cron is treated as source-era scaffolding, not as the target runtime design.

Revenants now treats research ingestion as a separate optional lane:

- `runtime-evolution`: runtime failures, retries, alerts, and recurring
  operational patterns
- `research-evolution`: optional external research signals such as new arXiv
  papers that can become reviewable proposals

Both lanes feed the same physics-gated proposal path. When
`autonomousApprovals` is enabled, proposals that pass pressure and conservation
checks can apply without a human approval command; conservation-blocked
proposals remain queued.

Research-derived proposals can now carry explicit landing metadata for the
current paper families under discussion:

- `GRAM` -> observer salience and proposal-routing surfaces
- `LDT` -> deliberation thresholds, queue gates, and runtime follow-up policy
- `PTRM` -> paper-to-runtime translation and implementation handoff

## Current Baseline

This baseline contains the reconciled plugin/docs lane and the Fedora Python
prototype/task lane. The current comparison point for source review is `main`
at `6bbd046`.

## Layout

```text
plugin/              OpenClaw plugin source
plugin/core/         Context/observer/data-store components
plugin/collectors/   Collection notes and trace collector docs
plugin/monitors/     Continuous monitors plus optional research-evolution source
tests/js/            JavaScript validation tests
docs/                Architecture, integration, handoff, and audit notes
docs/validation/     Validation plan and results
revenant/            Python prototype lane
revenant/tests/      Python validation tests
tasks/               Imported planning artifacts
```

## Source Review

Before wider agent expansion, read `docs/SOURCE_MATERIAL_REVIEW.md`. It records
what Revenants inherits from Remnant-Research and the Windows-era GNW plugin,
what it rejects from cron-era scaffolding, and what needs clarification before
new implementation branches begin.

## Validation

Run the JavaScript validation suite from the plugin directory:

```sh
cd plugin
npm test
```

## Review Surface

The plugin currently exposes two OpenClaw-facing tools:

- `revenants_status` for redacted observer/runtime state, recent traces, and
  queued promotions
- `revenants_review_queue` for inspecting queue pressure and manually
  reviewing promotion signals when autonomous approval is disabled or a
  conservation boundary blocks application
