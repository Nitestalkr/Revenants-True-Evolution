'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const sourceDataDir = path.join(repoRoot, 'data');
  const before = snapshotDir(sourceDataDir);
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-boundary-'));
  const plugin = (await import('../index.mjs')).default;
  const api = createFakeApi({
    dataDir: runtimeDir,
    startMonitors: false,
    queueMemoryProposals: true,
  });

  plugin.register(api);
  await api.services[0].start();
  await api.hooks.after_tool_call({
    sessionId: 'secret-session',
    sessionKey: 'discord:channel:123',
    channelId: '123',
    agentId: 'machine-spirit',
    toolName: 'exec',
    status: 'failed',
    error: 'token=should-not-leak',
  });

  const status = JSON.parse((await api.tools[0].execute({ limit: 10 })).content[0].text);
  const statusText = JSON.stringify(status);
  assert.ok(!statusText.includes('secret-session'));
  assert.ok(!statusText.includes('discord:channel:123'));
  assert.ok(!statusText.includes('channelId'));
  assert.ok(!statusText.includes('agentId'));
  assert.ok(!statusText.includes('should-not-leak'));
  assert.ok(fs.existsSync(path.join(runtimeDir, 'data', 'traces.jsonl')));
  assert.deepStrictEqual(snapshotDir(sourceDataDir), before, 'validation must not mutate source-tree data/');

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

function createFakeApi(pluginConfig) {
  return {
    pluginConfig,
    services: [],
    tools: [],
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
    on(name, handler) {
      this.hooks[name] = handler;
    },
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
