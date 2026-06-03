'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
  const plugin = (await import('../../plugin/index.mjs')).default;

  const disabledApi = createFakeApi({ enabled: false });
  plugin.register(disabledApi);
  assert.strictEqual(disabledApi.services.length, 0, 'disabled plugin must not register services');
  assert.strictEqual(disabledApi.tools.length, 0, 'disabled plugin must not register tools');
  assert.strictEqual(disabledApi.contextEngines.length, 0, 'disabled plugin must not register context engines');
  assert.deepStrictEqual(Object.keys(disabledApi.hooks), [], 'disabled plugin must not attach hooks');

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-state-'));
  const api = createFakeApi({}, stateDir);
  const sourceDataDir = path.resolve(__dirname, '../../plugin/data');
  const beforeSourceData = snapshotDir(sourceDataDir);
  plugin.register(api);

  assert.deepStrictEqual(snapshotDir(sourceDataDir), beforeSourceData, 'register must not mutate plugin/source data');
  assert.strictEqual(api.contextEngines.length, 0, 'companion mode must leave context engine unregistered');
  assert.strictEqual(api.services.length, 1, 'observer service should be registered');
  assert.ok(api.hooks.before_prompt_build, 'observer hook should be attached');

  await api.services[0].start();
  const runtimeDataDir = path.join(stateDir, 'revenants', 'data');
  assert.strictEqual(fs.existsSync(runtimeDataDir), true, 'service start should write under runtime state dir');
  assert.deepStrictEqual(snapshotDir(sourceDataDir), beforeSourceData, 'service start must not mutate plugin/source data');

  const status = JSON.parse((await api.tools[0].execute({ limit: 20 })).content[0].text);
  assert.strictEqual(status.mode, 'companion-observer');
  assert.ok(status.recentTraces.some((trace) => trace.action === 'plugin_start'), 'startup trace should be recorded');
  assert.ok(status.recentTraces.every((trace) => !String(trace.action).toLowerCase().includes('cron')), 'startup path must not depend on cron');
  assert.ok(!JSON.stringify(status).includes('sessionKey'), 'status should redact session keys by default');

  const noCronApi = createFakeApi({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-no-cron-')),
  });
  Object.defineProperty(noCronApi, 'cron', {
    get() {
      throw new Error('cron must not be accessed by plugin registration');
    },
  });
  plugin.register(noCronApi);
  await noCronApi.services[0].start();

  const { createRevenantsObserver } = require('../../plugin/core/observer');
  const { createRevenantsContextEngine } = require('../../plugin/core/context-engine');

  const directStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-direct-state-'));
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = directStateDir;
  try {
    const directObserver = createRevenantsObserver();
    await directObserver.start({});
    assert.deepStrictEqual(snapshotDir(sourceDataDir), beforeSourceData, 'direct observer default must not mutate plugin/source data');

    const directEngine = createRevenantsContextEngine();
    await directEngine.bootstrap();
    assert.deepStrictEqual(snapshotDir(sourceDataDir), beforeSourceData, 'direct context engine default must not mutate plugin/source data');
    assert.strictEqual(fs.existsSync(path.join(directStateDir, 'revenants', 'data')), true, 'direct defaults should use OpenClaw state dir');
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
    fs.rmSync(directStateDir, { recursive: true, force: true });
  }

  console.log('✓ plugin boundary validation passed');
}

function snapshotDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true })
    .map((entry) => {
      const file = path.join(dir, entry);
      const stat = fs.statSync(file);
      return {
        entry,
        isFile: stat.isFile(),
        size: stat.isFile() ? stat.size : 0,
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => a.entry.localeCompare(b.entry));
}

function createFakeApi(pluginConfig, stateDir = null) {
  return {
    pluginConfig,
    services: [],
    tools: [],
    contextEngines: [],
    hooks: {},
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    runtime: stateDir
      ? {
          state: {
            resolveStateDir() {
              return stateDir;
            },
          },
        }
      : undefined,
    registerService(service) {
      this.services.push(service);
    },
    registerTool(tool) {
      this.tools.push(tool);
    },
    registerContextEngine(id, factory) {
      this.contextEngines.push({ id, factory });
    },
    on(name, handler) {
      this.hooks[name] = handler;
    },
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
