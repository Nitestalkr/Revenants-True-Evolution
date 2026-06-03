'use strict';

const assert = require('assert');
const crypto = require('crypto');
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
  const sourceGuard = createSourceDataGuard(sourceDataDir);
  plugin.register(api);

  sourceGuard.assertUntouched('register must not write plugin/source data');
  assert.strictEqual(api.contextEngines.length, 0, 'companion mode must leave context engine unregistered');
  assert.strictEqual(api.services.length, 1, 'observer service should be registered');
  assert.ok(api.hooks.before_prompt_build, 'observer hook should be attached');

  await api.services[0].start();
  const runtimeDataDir = path.join(stateDir, 'revenants', 'data');
  assert.strictEqual(fs.existsSync(runtimeDataDir), true, 'service start should write under runtime state dir');
  sourceGuard.assertUntouched('service start must not write plugin/source data');

  const status = JSON.parse((await api.tools[0].execute({ limit: 20 })).content[0].text);
  assert.strictEqual(status.mode, 'companion-observer');
  assert.ok(status.recentTraces.some((trace) => trace.action === 'plugin_start'), 'startup trace should be recorded');
  assert.ok(status.recentTraces.every((trace) => !String(trace.action).toLowerCase().includes('cron')), 'startup path must not depend on cron');

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

  const monitorsStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-monitors-state-'));
  const monitorsApi = createFakeApi({ startMonitors: true }, monitorsStateDir);
  plugin.register(monitorsApi);
  await monitorsApi.services[0].start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await monitorsApi.services[0].stop();
  assert.strictEqual(
    fs.existsSync(path.join(monitorsStateDir, 'revenants', 'data', 'stability-state.json')),
    true,
    'startMonitors should write monitor state under runtime state dir',
  );
  sourceGuard.assertUntouched('startMonitors must not write plugin/source data');

  const { createRevenantsObserver } = require('../../plugin/core/observer');
  const { createRevenantsContextEngine } = require('../../plugin/core/context-engine');

  const directStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-direct-state-'));
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = directStateDir;
  try {
    const directObserver = createRevenantsObserver();
    await directObserver.start({});
    sourceGuard.assertUntouched('direct observer default must not write plugin/source data');

    const directEngine = createRevenantsContextEngine();
    await directEngine.bootstrap();
    sourceGuard.assertUntouched('direct context engine default must not write plugin/source data');
    assert.strictEqual(fs.existsSync(path.join(directStateDir, 'revenants', 'data')), true, 'direct defaults should use OpenClaw state dir');
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
    fs.rmSync(directStateDir, { recursive: true, force: true });
    fs.rmSync(monitorsStateDir, { recursive: true, force: true });
    sourceGuard.cleanup();
  }

  console.log('✓ plugin boundary validation passed');
}

function createSourceDataGuard(sourceDataDir) {
  const existedBefore = fs.existsSync(sourceDataDir);
  if (!existedBefore) fs.mkdirSync(sourceDataDir, { recursive: true });

  const sentinelName = `.boundary-sentinel-${process.pid}-${Date.now()}`;
  const sentinelPath = path.join(sourceDataDir, sentinelName);
  const sentinelContent = `sentinel:${sentinelName}`;
  fs.writeFileSync(sentinelPath, sentinelContent);

  const before = snapshotDir(sourceDataDir);

  return {
    assertUntouched(message) {
      const after = snapshotDir(sourceDataDir);
      assert.deepStrictEqual(after, before, message);
      assert.strictEqual(fs.readFileSync(sentinelPath, 'utf8'), sentinelContent, `${message}: sentinel changed`);
    },
    cleanup() {
      fs.rmSync(sentinelPath, { force: true });
      if (!existedBefore) {
        try {
          fs.rmdirSync(sourceDataDir);
        } catch (_) {
          // Leave any unexpected files for inspection; never remove recursively.
        }
      }
    },
  };
}

function snapshotDir(dir) {
  if (!fs.existsSync(dir)) return {};
  const entries = {};
  for (const file of walkFiles(dir)) {
    const rel = path.relative(dir, file);
    entries[rel] = hashFile(file);
  }
  return entries;
}

function walkFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
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
