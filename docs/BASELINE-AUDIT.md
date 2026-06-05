# Revenants Baseline Audit

This note captures the agreed first-baseline import shape for the Revenants
repository.

## Include

- `README.md`
- `AGENTS.md`
- `.gitignore`
- `docs/ARCHITECTURE.md`
- `docs/LIBRAVDB-INTEGRATION.md`
- `docs/AGENT_HANDOFF.md`
- `docs/validation/*`
- `plugin/index.mjs`
- `plugin/openclaw.plugin.json`
- `plugin/package.json`
- `plugin/core/*`
- `plugin/collectors/*`
- `plugin/monitors/*`
- `tests/js/validate-monitor-suite.js`
- `tests/js/validate-context-engine.js`
- `tests/js/validate-companion-mode.js`
- `revenant/engine/*`
- `revenant/tests/*`
- `tasks/revenants-task-2.json`
- `tasks/revenants-task-3.json`

## Exclude

- `data/`
- `*.jsonl`
- `node_modules/`
- `.venv/`
- `venv/`
- `logs/`
- `tmp/`
- `*.log`
- `__pycache__/`
- `*.py[cod]`
- `.pytest_cache/`
- `.npm/`
- `.nyc_output/`
- `coverage/`
- `.env*`
- `*.pem`
- `*.key`
- `.DS_Store`
- `.vscode/`
- `.idea/`

## Conflict Rules

- No root-level `core/` in the canonical baseline.
- JavaScript/OpenClaw source lives under `plugin/`.
- Python prototype source lives under `revenant/`.
- Fedora pytest remains under `revenant/tests/` for the first baseline.
- Fixtures only live under `tests/fixtures/` with explicit owner approval.
- Runtime state, traces, workspace metadata, caches, and secrets do not land in
  the first baseline.

## Source Mapping

Shape B / plugin-docs local copy maps as:

- `index.mjs` -> `plugin/index.mjs`
- `openclaw.plugin.json` -> `plugin/openclaw.plugin.json`
- `package.json` -> `plugin/package.json`
- `core/*` -> `plugin/core/*`
- `collectors/*` -> `plugin/collectors/*`
- `monitors/*` -> `plugin/monitors/*`
- `test/validate-*.js` -> `tests/js/validate-*.js`
- `docs/*` -> `docs/*`
- `test/VALIDATION-*.md` -> `docs/validation/*`

Shape A / Fedora copy maps as:

- `revenant/engine/*` -> `revenant/engine/*`
- `revenant/tests/*` -> `revenant/tests/*`
- `revenants-task-2.json` -> `tasks/revenants-task-2.json`
- `revenants-task-3.json` -> `tasks/revenants-task-3.json`
