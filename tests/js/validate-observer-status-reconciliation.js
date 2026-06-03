'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
  const plugin = (await import('../../plugin/index.mjs')).default;
  const sharedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-reconcile-'));

  const writerApi = createFakeApi({ dataDir: sharedDataDir, startMonitors: false });
  plugin.register(writerApi);
  await writerApi.services[0].start();
  await writerApi.hooks.before_tool_call({
    toolName: 'exec',
    status: 'started',
    durationMs: 10,
  }, {
    sessionId: 's-1',
    sessionKey: 'discord:general',
    trigger: 'message',
    agentId: 'machinespirit',
  });

  const readerApi = createFakeApi({ dataDir: sharedDataDir, startMonitors: false });
  plugin.register(readerApi);

  const statusResult = await readerApi.tools.find((tool) => tool.name === 'revenants_status').execute({ limit: 5 });
  const status = JSON.parse(statusResult.content[0].text);

  assert.strictEqual(status.started, true, 'status should reconcile started=true from shared live trace activity');
  assert.strictEqual(status.monitorsRunning, false, 'monitor state should stay false when monitors were never enabled');

  await writerApi.services[0].stop();

  const stoppedResult = await readerApi.tools.find((tool) => tool.name === 'revenants_status').execute({ limit: 5 });
  const stoppedStatus = JSON.parse(stoppedResult.content[0].text);
  assert.strictEqual(stoppedStatus.started, false, 'status should fall back to false after shared observer stop is recorded');

  console.log('observer status reconciliation validation passed');
}

function createFakeApi(pluginConfig) {
  const api = {
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
  return api;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
