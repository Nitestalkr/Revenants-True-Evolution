'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
  const plugin = (await import('../../plugin/index.mjs')).default;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-chat-bridge-'));
  const mutationRoot = path.join(tempRoot, 'workspace');
  const fakeBinDir = path.join(tempRoot, 'bin');
  const sentArgsFile = path.join(tempRoot, 'sent-args.jsonl');
  fs.mkdirSync(mutationRoot, { recursive: true });
  fs.writeFileSync(path.join(mutationRoot, 'AGENTS.md'), '# Agent Notes\n');
  fs.mkdirSync(fakeBinDir, { recursive: true });

  const fakeOpenclaw = path.join(fakeBinDir, 'openclaw');
  fs.writeFileSync(fakeOpenclaw, [
    '#!/usr/bin/env node',
    'const fs = require("fs");',
    `fs.appendFileSync(${JSON.stringify(sentArgsFile)}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
    'process.exit(0);',
    '',
  ].join('\n'));
  fs.chmodSync(fakeOpenclaw, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${fakeBinDir}:${previousPath || ''}`;

  try {
    const api = createFakeApi({
      dataDir: path.join(tempRoot, 'state'),
      mutationRoot,
      queueMemoryProposals: true,
      notifySessionOnProposal: true,
    });

    plugin.register(api);
    await api.services[0].start();

    await api.hooks.message_received({
      sessionId: 's-1',
      sessionKey: 'agent:main:discord:channel:1473342935373447372',
      senderId: '476437650849529856',
      messageId: 'm-1',
      channelId: '1473342935373447372',
      channel: 'discord',
      content: '@Machine Spirit please review this',
    }, {});
    await api.hooks.after_tool_call({
      sessionId: 's-1',
      sessionKey: 'agent:main:discord:channel:1473342935373447372',
      toolName: 'web_fetch',
      status: 'failed',
      error: 'blocked',
      durationMs: 50,
    }, {});

    await delay(100);

    const queueTool = api.tools.find((tool) => tool.name === 'revenants_review_queue');
    const before = JSON.parse((await queueTool.execute({ action: 'peek', limit: 5 })).content[0].text);
    const proposalId = before.recent[0]?.id;
    assert.ok(proposalId, 'proposal should be queued before bridge approval');

    await api.hooks.message_received({
      sessionId: 's-1',
      sessionKey: 'agent:main:discord:channel:1473342935373447372',
      senderId: '476437650849529856',
      messageId: 'm-2',
      channelId: '1473342935373447372',
      channel: 'discord',
      content: `@Machine Spirit revenants approve ${proposalId}`,
    }, {});

    await delay(100);

    const after = JSON.parse((await queueTool.execute({ action: 'peek', limit: 5 })).content[0].text);
    assert.strictEqual(after.queuedCount, 0, 'bridge command should remove approved proposal from queue');

    const lines = fs.readFileSync(sentArgsFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const approvalMessage = lines.at(-1);
    const messageFlagIndex = approvalMessage.indexOf('--message');
    assert.ok(messageFlagIndex >= 0, 'bridge reply should send a chat message');
    assert.ok(approvalMessage[messageFlagIndex + 1].includes('Revenants approved'), 'bridge reply should confirm approval');
    assert.ok(approvalMessage[messageFlagIndex + 1].includes('Routed as policy -> AGENTS.md via doc-patch.'), 'bridge reply should include mutation routing');

    console.log('chat review bridge validation passed');
  } finally {
    process.env.PATH = previousPath;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
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
      const existing = this.hooks[name];
      if (!existing) {
        this.hooks[name] = handler;
        return;
      }
      this.hooks[name] = async (...args) => {
        await existing(...args);
        return handler(...args);
      };
    },
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
