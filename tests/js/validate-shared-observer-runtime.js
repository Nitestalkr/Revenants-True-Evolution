'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
  const plugin = (await import('../../plugin/index.mjs')).default;
  const sharedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-shared-runtime-'));

  const writerApi = createFakeApi({
    dataDir: sharedRoot,
    queueMemoryProposals: true,
  });
  const readerApi = createFakeApi({
    dataDir: sharedRoot,
    queueMemoryProposals: true,
  });

  plugin.register(writerApi);
  plugin.register(readerApi);

  await writerApi.services[0].start();

  await readerApi.hooks.after_tool_call({
    sessionId: 's-1',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'web_fetch',
    status: 'failed',
    error: 'blocked',
    durationMs: 15,
  }, {});
  await readerApi.hooks.after_tool_call({
    sessionId: 's-1b',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'web_fetch',
    status: 'failed',
    error: 'blocked',
    durationMs: 15,
  }, {});

  const statusTool = readerApi.tools.find((tool) => tool.name === 'revenants_status');
  const status = JSON.parse((await statusTool.execute({ limit: 5 })).content[0].text);

  assert.strictEqual(status.state.counters.toolFailuresObserved, 2, 'shared observer should count failures from later registrations');
  assert.ok(status.queuedPromotions.length >= 1, 'shared observer should queue promotions from later registration hooks');
  assert.strictEqual(status.queuedPromotions.at(-1)?.proposalType, 'tooling');

  await writerApi.services[0].stop();

  console.log('shared observer runtime validation passed');
}

function createFakeApi(pluginConfig) {
  return {
    pluginConfig,
    services: [],
    tools: [],
    commands: {},
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
    registerCommand(command) {
      this.commands[command.name] = command;
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
