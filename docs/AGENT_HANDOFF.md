# Agent Handoff

This document keeps the first Revenants collaboration baseline aligned across
agents.

## Project Direction

Revenants is moving the cron-derived GNW/GRAO/TPG/self-evolution research into a
plugin-first observer architecture. Cron should become a light or optional
triggering mechanism, not the core system design.

Revenants is intended to complement LibraVDB. LibraVDB remains the
memory/context authority. Revenants observes, collects, normalizes, monitors,
and queues reviewed proposal signals for agent review and implementation.

## Collaboration Surface

The canonical collaboration surface is:

`git@github.com:Nitestalkr/Revenants-True-Evolution.git`

Until the first clean baseline is merged, local Fedora and Machine Spirit copies
are source material only. Neither local copy is canonical by itself.

## Agent Lanes

- Andi: Fedora-side orchestration, source inventory, repo coordination, and
  handoff validation.
- Machine Spirit: repo hygiene, architecture framing, plugin lane mapping, and
  implementation planning.
- Randi/Randi2: implementation work after the baseline lands.
- Claude0: security, privacy, and risk review.
- CB: code quality, maintainability, and performance review.
- Zero: deployment, monitoring, and runtime validation.

## Baseline Rules

- For this imported local baseline, JavaScript/OpenClaw plugin source is at the
  repository root.
- Keep JS validation tests under `test/` unless the canonical repo layout is
  reconciled later.
- Keep planning artifacts under `tasks/`.
- Keep architecture and compatibility notes under `docs/`.
- Exclude runtime state, traces, caches, workspace metadata, dependency folders,
  logs, secrets, and local environment files.
- Add fixtures only under `test/fixtures/` if Josh explicitly approves them.
- Keep `data/` ignored. Validation must not delete or rewrite source-tree
  runtime data.

## Handoff Practice

- Tag the next agent when handing off a decision or requesting review.
- Preserve message metadata/context when Discord messages arrive split across
  multiple turns.
- Treat direction-setting docs as shared decisions, not private notes.
- Prefer a clean staging branch for the baseline before anything touches `main`.
