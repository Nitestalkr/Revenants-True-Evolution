'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
  const plugin = (await import('../../plugin/index.mjs')).default;

  const api = createFakeApi({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-companion-')),
    queueMemoryProposals: true,
  });

  plugin.register(api);

  assert.strictEqual(api.contextEngines.length, 0, 'companion mode must not register a context engine by default');
  assert.strictEqual(api.services.length, 1, 'observer service should be registered');
  assert.strictEqual(api.tools.length, 2, 'status and review queue tools should be registered');

  await api.services[0].start();
  assert.ok(api.hooks.before_prompt_build, 'observer should subscribe to before_prompt_build');
  await api.hooks.before_prompt_build({}, {
    sessionId: 's-1',
    sessionKey: 'discord:general',
    trigger: 'message',
    agentId: 'machinespirit',
  });
  await api.hooks.after_tool_call({
    sessionId: 's-1',
    toolName: 'exec',
    status: 'failed',
    error: 'timeout',
    durationMs: 1000,
  });

  const statusResult = await api.tools[0].execute({ limit: 5 });
  const status = JSON.parse(statusResult.content[0].text);

  assert.strictEqual(status.mode, 'companion-observer');
  assert.ok(status.registeredHooks.includes('before_prompt_build'));
  assert.strictEqual(status.state.counters.toolCallsObserved, 1);
  assert.strictEqual(status.state.counters.toolFailuresObserved, 1);
  assert.ok(status.recentTraces.some((trace) => trace.action === 'before_prompt_build'));
  assert.ok(!status.recentTraces.some((trace) => trace.sessionKey), 'status output should redact session keys by default');
  assert.ok(!status.recentTraces.some((trace) => trace.metadata?.channelId), 'status output should redact channel ids by default');
  assert.ok(status.state.counters.promotionsQueued >= 1, 'failed tool trace should queue a promotion');
  assert.ok(status.queuedPromotions.some((promotion) => promotion.intent === 'stabilize-runtime'));
  assert.ok(status.state.grao.activeProposals.includes('stabilize-runtime'));

  const queueTool = api.tools.find((tool) => tool.name === 'revenants_review_queue');
  assert.ok(queueTool, 'review queue tool should be available');

  const peekResult = await queueTool.execute({ action: 'peek', limit: 5 });
  const peek = JSON.parse(peekResult.content[0].text);
  assert.strictEqual(peek.queuedCount >= 1, true);
  assert.ok(peek.intents.some((intent) => intent.intent === 'stabilize-runtime'));

  const ackTarget = peek.recent[0]?.id;
  assert.ok(ackTarget, 'peek should expose queued promotion ids');

  const ackResult = await queueTool.execute({
    action: 'ack',
    ids: [ackTarget],
    reviewer: 'machine-spirit',
    note: 'validated during test',
  });
  const ack = JSON.parse(ackResult.content[0].text);
  assert.strictEqual(ack.acknowledgedCount, 1);
  assert.strictEqual(ack.acknowledgedIds[0], ackTarget);

  const experimentalApi = createFakeApi({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-context-')),
    registerContextEngine: true,
  });
  plugin.register(experimentalApi);
  assert.strictEqual(experimentalApi.contextEngines.length, 0, 'context engine should require explicit LibraVDB-adjacent slot');

  const guardedExperimentalApi = createFakeApi({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-context-')),
    registerContextEngine: true,
    contextEngineSlot: 'libravdb-adjacent',
  });
  plugin.register(guardedExperimentalApi);

  assert.strictEqual(guardedExperimentalApi.contextEngines.length, 1, 'guarded experimental mode should register a context engine');

  console.log('✓ companion mode validation passed');
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
