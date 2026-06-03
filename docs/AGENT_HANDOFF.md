# Agent Handoff

This document keeps the first Revenants collaboration baseline aligned across
agents.

## Project Direction

Revenants is moving the cron-derived GNW/GRAO/TPG/self-evolution research into a
plugin-first observer architecture. Cron is source-era scaffolding and should
not be treated as part of the target runtime architecture.

Revenants is intended to complement LibraVDB. LibraVDB remains the
memory/context authority. Revenants observes, collects, normalizes, monitors,
and queues promotion signals for agent review and implementation.

## Collaboration Surface

The canonical collaboration surface is:

`git@github.com:Nitestalkr/Revenants-True-Evolution.git`

The reconciled baseline is `main` at `6bbd046`. Older local Fedora and Machine
Spirit copies are source material only. Neither local copy is canonical by
itself.

Before wider agent expansion, read `docs/SOURCE_MATERIAL_REVIEW.md`. That review
defines which GNW/GRAO ideas carry forward, which cron-era mechanisms are
rejected, and which boundaries need clarification before implementation work.

## Agent Lanes

- Andi: Fedora-side orchestration, source inventory, repo coordination, and
  handoff validation.
- Machine Spirit: repo hygiene, architecture framing, plugin lane mapping, and
  implementation planning.
- Randi/Randi2: implementation work after the baseline lands.
- Claude0: security, privacy, and risk review.
- CB: code quality, maintainability, and performance review.
- Zero: deployment, monitoring, and runtime validation.

Do not start these implementation/review lanes until Josh signs off on the
source-material cross-exam.

## Baseline Rules

- Keep JavaScript/OpenClaw plugin source under `plugin/`.
- Keep the Python prototype under `revenant/`.
- Keep Fedora pytest under `revenant/tests/` for the first baseline.
- Keep JS validation tests under `tests/js/`.
- Keep planning artifacts under `tasks/`.
- Keep architecture and compatibility notes under `docs/`.
- Exclude runtime state, traces, caches, workspace metadata, dependency folders,
  logs, secrets, and local environment files.
- Add fixtures only under `tests/fixtures/` if Josh explicitly approves them.
- Treat cron references in imported tasks or validation notes as legacy source
  evidence unless a current direction-setting doc says otherwise.

## Handoff Practice

- Tag the next agent when handing off a decision or requesting review.
- Preserve message metadata/context when Discord messages arrive split across
  multiple turns.
- Treat direction-setting docs as shared decisions, not private notes.
- Prefer a clean staging branch for the baseline before anything touches `main`.
