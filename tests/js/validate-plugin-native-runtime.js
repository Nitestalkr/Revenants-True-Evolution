'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
  const manifest = require('../../plugin/openclaw.plugin.json');
  const pluginPackage = require('../../plugin/package.json');
  const plugin = (await import('../../plugin/index.mjs')).default;
  const api = createFakeOpenClawApi({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-plugin-native-')),
    startMonitors: false,
  });

  assert.strictEqual(manifest.id, 'revenants', 'manifest id should be revenants');
  assert.strictEqual(manifest.activation?.onStartup, true, 'manifest should use plugin startup activation');
  assert.ok(pluginPackage.openclaw?.extensions?.includes('./index.mjs'), 'package should expose plugin extension');

  plugin.register(api);

  assert.strictEqual(api.services.length, 1, 'plugin should register one observer service');
  assert.strictEqual(api.tools.length, 2, 'plugin should register status and review queue tools');
  assert.ok(api.hookNames.includes('before_prompt_build'), 'plugin should subscribe through OpenClaw hooks');
  assert.strictEqual(api.contextEngines.length, 0, 'LibraVDB should remain default context authority');
  assert.deepStrictEqual(api.schedulerCalls, [], 'plugin must not call cron/scheduler APIs during registration');

  await api.services[0].start();
  const statusResult = await api.tools.find((tool) => tool.name === 'revenants_status').execute({ limit: 5 });
  const status = JSON.parse(statusResult.content[0].text);

  assert.strictEqual(status.mode, 'companion-observer', 'default runtime should be companion observer mode');
  assert.strictEqual(status.started, true, 'observer service should start');
  assert.strictEqual(status.monitorsRunning, false, 'monitors should be explicit opt-in for smoke validation');
  assert.ok(status.recentTraces.some((trace) => trace.action === 'plugin_start'), 'startup trace should be recorded');

  await api.services[0].stop();

  console.log('plugin-native runtime validation passed');
}

function createFakeOpenClawApi(pluginConfig) {
  return {
    pluginConfig,
    services: [],
    tools: [],
    contextEngines: [],
    hookNames: [],
    schedulerCalls: [],
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    registerService(service) {
      this.services.push(service);
    },
    registerTool(tool) {
      this.tools.push(tool);
    },
    registerContextEngine(id, factory) {
      this.contextEngines.push({ id, factory });
    },
    on(name) {
      this.hookNames.push(name);
    },
    registerCron(...args) {
      this.schedulerCalls.push(['registerCron', args]);
    },
    schedule(...args) {
      this.schedulerCalls.push(['schedule', args]);
    },
    registerScheduler(...args) {
      this.schedulerCalls.push(['registerScheduler', args]);
    },
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
