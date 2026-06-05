# Agent Notes

This repository is the collaboration surface for Revenants True Evolution.

## Direction

Revenants is a plugin-first companion layer for cron-derived GNW/GRAO/TPG and
self-evolution research. It complements LibraVDB rather than replacing it.
LibraVDB remains the memory/context authority.

## Baseline Rules

- Keep JavaScript/OpenClaw plugin source under `plugin/`.
- Keep JavaScript validation under `tests/js/`.
- Keep architecture, integration, handoff, and audit notes under `docs/`.
- Do not commit runtime `data/`, traces, caches, logs, local env files, secrets,
  dependency folders, or workspace metadata.
- Add fixtures only under `tests/fixtures/` after explicit owner approval.

## Mutation 2c2bec1533b8677e

- Applied: 2026-06-04T01:35:25.325Z
- Intent: stabilize-runtime
- Type: policy
- Reason: after_tool_call for web_fetch completed with failure
- Apply path: Patch AGENTS.md with safer handling and escalation guidance for this failure class.

## Mutation f649143a6f11335a

- Applied: 2026-06-04T02:11:32.263Z
- Intent: stabilize-runtime
- Type: policy
- Reason: after_tool_call for web_fetch completed with failure
- Apply path: Patch AGENTS.md with safer handling and escalation guidance for this failure class.
