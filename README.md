# Revenants True Evolution

Revenants is an OpenClaw companion evolution layer for continuous GNW/GRAO trace
collection, monitor orchestration, and LibraVDB promotion signals.

The project is moving cron-derived research away from a cron-heavy
implementation and toward a plugin-first architecture:

- The plugin observes, collects, normalizes, monitors, and queues signals.
- LibraVDB remains the memory/context authority.
- Agent turns handle reasoning, review, proposals, implementation decisions,
  and validation.
- Cron becomes optional/light scheduling instead of the core system design.

## Current Baseline

This baseline contains Machine Spirit's reconciled plugin-side import plus
direction-setting docs. Fedora's Python prototype lane is tracked separately for
review and comparison before the complete baseline is finalized.

## Layout

```text
plugin/              OpenClaw plugin source
plugin/core/         Context/observer/data-store components
plugin/collectors/   Collection notes and trace collector docs
plugin/monitors/     Continuous monitors and monitor suite
tests/js/            JavaScript validation tests
docs/                Architecture, integration, handoff, and audit notes
docs/validation/     Validation plan and results
```

## Validation

Run the JavaScript validation suite from the plugin directory:

```sh
cd plugin
npm test
```
