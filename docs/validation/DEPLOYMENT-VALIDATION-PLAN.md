# Deployment Validation Plan

Branch: `machine-spirit/revenants-boundary-hardening`

Baseline: `main` at `658e34a5321565c545645c1ecbd1811bc9c9301f`

## Scope

This plan validates that Revenants can be shipped as an OpenClaw plugin-native
component without reintroducing cron as the target runtime architecture.

This plan covers:

- plugin-native registration and runtime smoke checks
- CI gates for executable plugin behavior
- cron dependency guardrails
- deployment readiness evidence
- monitoring signals expected after deployment

## Plugin-Native Runtime Gate

Run from `plugin/`:

```sh
npm run test:plugin-native
```

This validates:

- `plugin/openclaw.plugin.json` identifies the `revenants` plugin.
- `plugin/package.json` exposes `./index.mjs` through the OpenClaw extension
  surface.
- `plugin/index.mjs` registers through OpenClaw plugin APIs.
- The default mode is companion observer mode.
- LibraVDB remains the default context authority because Revenants does not
  register a context engine unless explicitly enabled and guarded.
- Startup records plugin traces through the observer service.
- Registration does not call fake cron or scheduler APIs.

## Runtime Smoke Checks

Run from `plugin/`:

```sh
npm test
```

Current smoke coverage:

- monitor suite wiring
- context engine bootstrap, ingest, assemble, after-turn, and compact behavior
- companion mode registration, hook capture, status tool output, review queue,
  and queued LibraVDB promotion signals
- plugin boundary checks for disabled mode, runtime state writes, and redaction

The Python prototype should stay visible, but plugin deployment should be gated
by the JavaScript/OpenClaw validation lane until the Python prototype owns a
separate executable CI contract again.

## Cron Historical-Only Guard

Run from `plugin/`:

```sh
npm run test:cron-guard
```

The guard fails on active cron runtime patterns such as:

- `node-cron`
- `cron.schedule(...)`
- `new CronJob(...)`
- `registerCron(...)`
- `crontab`
- `/etc/cron`
- systemd timer language
- APScheduler or Celery beat

Allowed cron references are limited to explicitly historical, migration, or
diagnostic surfaces:

- `docs/`
- `tasks/`
- markdown source-era monitor notes
- `plugin/monitors/cron-health-monitor.js`
- monitor-suite compatibility wiring and its existing validation tests

The `LegacyCronSignalMonitor` naming should remain clearly historical. It is
allowed as passive event tracking and alert compatibility, not as a runtime
scheduler.

## CI Shape

The CI workflow should include:

- `plugin-validation`: Node 22, `npm run ci` from `plugin/`
- `python-prototype-collection`: Python 3.12, `pytest --collect-only
  revenant/tests`, tolerated if it exits with code 5 for zero collection during
  the current prototype state

The plugin validation job is the deployment gate. It should run:

- existing JS smoke tests
- plugin-native runtime validation
- cron historical-only guard

## Deployment Checklist

Before deployment:

- Checkout a clean branch from the canonical repo.
- Confirm `plugin/openclaw.plugin.json` is present and loads.
- Run `cd plugin && npm run ci`.
- Confirm no deployment instructions require cron, crontab, systemd timers, or
  external periodic runners.
- Confirm LibraVDB remains the memory/context authority unless explicitly
  approving experimental context-engine registration.
- Confirm runtime state paths remain outside the repo.

After deployment:

- Confirm OpenClaw reports plugin startup.
- Confirm the `revenants_status` tool is available.
- Confirm the `revenants_review_queue` tool is available.
- Confirm observer service starts and records `plugin_start`.
- Confirm hooks are registered for gateway/session/tool/model/context events.
- Confirm queued promotions are reviewable signals, not silent memory writes.
- Confirm logs expose plugin start failures, hook registration failures, monitor
  alerts, and tool execution failures.

## Monitoring Signals

Recommended runtime signals:

- plugin load success/failure
- observer service start/stop
- hook registration count
- status tool invocation success/failure
- review-queue tool invocation success/failure
- tool-call failure traces
- queued promotion count
- reviewed promotion count
- monitor alert count when monitors are explicitly enabled
- filesystem write failures under the configured plugin data directory

Recommended alerts:

- plugin fails to load on startup
- observer service cannot start
- hook API is unavailable
- status tool fails repeatedly
- review queue grows without review
- monitor alert severity reaches error when monitor suite is enabled

These alerts should be driven by OpenClaw runtime monitoring, logs, or external
observability. They must not be implemented as cron jobs for Revenants.
