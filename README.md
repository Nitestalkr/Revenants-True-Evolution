# Revenants True Evolution

Revenants is an OpenClaw companion evolution layer for continuous GNW/GRAO trace
collection, monitor orchestration, and LibraVDB promotion signals.

The project is moving cron-derived research away from a cron-heavy
implementation and toward a plugin-first architecture:

- The plugin observes, collects, normalizes, monitors, and queues signals.
- LibraVDB remains the memory/context authority.
- Agent turns handle reasoning, review, proposals, implementation decisions,
  and validation.
- Cron is treated as source-era scaffolding, not as the target runtime design.

## Current Baseline

This baseline contains the reconciled Machine Spirit plugin/docs lane and the
Fedora Python prototype/task lane. The current comparison point for source
review is `main` at `6bbd046`.

## Layout

```text
plugin/              OpenClaw plugin source
plugin/core/         Context/observer/data-store components
plugin/collectors/   Collection notes and trace collector docs
plugin/monitors/     Continuous monitors and monitor suite
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
