# Source Material Review

This review records the source-material cross-exam completed before expanding
Revenants to the wider agent team.

## Status

- Baseline: `main` at `6bbd046`.
- Scope: resource material only.
- Output shape: inherit, reject, clarify.
- No implementation lane starts until owner signoff completes for this review.

## Source Set

Primary source fronts:

- `remnant-research/gnw/`
- `remnant-research/tpg-grao/`
- `remnant-research/plugin/`
- `remnant-research/gnw/docs/GNW-GRAO-INTEGRATION.md`

Supporting evidence only:

- `remnant-research/archive/gnw-plugin-reset-20260519-1100/plugin/`

The archive copy is provenance. It should not be treated as a source for new
implementation.

## Inherit

Revenants should carry forward the reusable GNW/GRAO theory as plugin-native
behavior:

- GNW drive model: curiosity, helpfulness, competence, safety, and
  goal-directed pressure.
- Boredom and staleness as attention signals.
- Safety veto and conflict-resolution concepts.
- Continuous trace collection and monitoring.
- GRAO trace to gradient to proposal to experience feedback theory.
- Saturation and exploration signals from repeated patterns.
- Plugin contract shape from the Windows-era GNW plugin.
- Gateway lifecycle hooks and tool/model/context observation.
- Trace, gradient, proposal, and promotion vocabulary.
- LibraVDB as the memory/context authority, with Revenants queuing promotion
  signals instead of owning durable memory.

These concepts should become advisory plugin behavior, not autonomous commands.

## Reject

Revenants should explicitly leave behind cron-era scaffolding:

- Cron jobs as the loop driver or core execution model.
- Heartbeat or `agentTurn` cron as a required execution path.
- Heartbeat prompt contribution as the required cognitive-cycle driver.
- Proposal delivery through cron payloads.
- Cron config mutation as an optimization target.
- Fixed periodic self-evolution jobs.
- JSON state files as authoritative long-term memory or policy.
- Direct GNW/GRAO mutation of LibraVDB memory.
- Direct drive-weight mutation as automatic runtime policy.
- Automatic self-evolution or policy mutation without agent review.
- Any documentation that implies "cron-light" remains the target architecture.

Cron-derived artifacts can remain as historical comparison evidence, but not as
the design target.

## Clarify

Before Randi, Randi2, Claude0, CB, or Zero branch from the baseline, document the
following boundaries:

- **Revenants vs LibraVDB:** Revenants observes, normalizes, monitors, and queues
  promotion signals. LibraVDB owns durable memory, context assembly, recall,
  ranking, and compaction.
- **Advisory vs authoritative state:** GNW drive pressure and GRAO gradients are
  advisory signals until an agent reviews them.
- **Tested vs conceptual:** JS monitor/context/companion validation and Python
  pytest are proven baseline behavior. GNW/GRAO inheritance beyond that remains
  design intent until implemented and tested.
- **Runtime state:** `data/`, `*.jsonl`, caches, logs, dependency folders, local
  env files, and secrets stay out of the repo. Approved examples belong only
  under `tests/fixtures/`.
- **Legacy monitors:** `CronHealthMonitor` and similar names should be treated as
  migration diagnostics or renamed before they become part of the main
  architecture language.
- **Imported tasks:** Task JSONs may contain Windows-era or cron-era language.
  Treat that wording as source provenance unless current docs confirm it.

## Review Verdict

The lineage is coherent, but the inheritance is selective.

Revenants inherits GNW/GRAO cognition and feedback theory, but re-hosts it in
plugin hooks, continuous events, normalized traces, and agent-reviewed promotion
signals. LibraVDB remains the memory/context authority. Cron-era execution
machinery stays behind.
