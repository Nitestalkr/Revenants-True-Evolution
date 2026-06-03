'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
  const plugin = (await import('../../plugin/index.mjs')).default;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-proposals-'));
  const fakeBinDir = path.join(tempRoot, 'bin');
  const sentArgsFile = path.join(tempRoot, 'sent-args.json');
  fs.mkdirSync(fakeBinDir, { recursive: true });

  const fakeOpenclaw = path.join(fakeBinDir, 'openclaw');
  fs.writeFileSync(fakeOpenclaw, [
    '#!/usr/bin/env node',
    'const fs = require("fs");',
    `fs.writeFileSync(${JSON.stringify(sentArgsFile)}, JSON.stringify(process.argv.slice(2), null, 2));`,
    'process.exit(0);',
    '',
  ].join('\n'));
  fs.chmodSync(fakeOpenclaw, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${fakeBinDir}:${previousPath || ''}`;

  try {
    const api = createFakeApi({
      dataDir: path.join(tempRoot, 'state'),
      queueMemoryProposals: true,
      notifySessionOnProposal: true,
    });

    plugin.register(api);

    assert.ok(api.commands.revenants, 'revenants command should be registered');

    await api.services[0].start();
    await api.hooks.message_received({
      sessionId: 's-1',
      sessionKey: 'agent:main:discord:channel:1473342935373447372',
      senderId: '476437650849529856',
      messageId: '1511775773076230174',
      channelId: '1473342935373447372',
      channel: 'discord',
      content: '@Machine Spirit please review this',
    }, {});
    await api.hooks.after_tool_call({
      sessionId: 's-1',
      sessionKey: 'agent:main:discord:channel:1473342935373447372',
      toolName: 'exec',
      status: 'failed',
      error: 'timeout',
      durationMs: 1200,
    }, {});

    await delay(200);

    const sentArgs = JSON.parse(fs.readFileSync(sentArgsFile, 'utf8'));
    assert.deepStrictEqual(sentArgs.slice(0, 6), [
      'message',
      'send',
      '--channel',
      'discord',
      '--target',
      'channel:1473342935373447372',
    ], 'proposal notification should route back to the active Discord channel');
    assert.ok(sentArgs.includes('--reply-to'), 'proposal notification should thread off the triggering message when available');
    const messageFlagIndex = sentArgs.indexOf('--message');
    assert.ok(messageFlagIndex >= 0, 'proposal notification should include message text');
    const message = sentArgs[messageFlagIndex + 1];
    assert.ok(message.includes('Revenants proposal queued'), 'proposal notification should announce queued proposal');
    assert.ok(message.includes('revenants approve'), 'proposal notification should include in-chat approval guidance');

    const queueReply = await api.commands.revenants.handler({
      args: 'queue',
      senderId: '476437650849529856',
      sessionKey: 'agent:main:discord:channel:1473342935373447372',
    });
    assert.ok(queueReply.text.includes('Queued proposals: 1'), 'queue command should summarize queued proposals');

    const statusTool = api.tools.find((tool) => tool.name === 'revenants_review_queue');
    const peek = JSON.parse((await statusTool.execute({ action: 'peek', limit: 5 })).content[0].text);
    const proposalId = peek.recent[0]?.id;
    assert.ok(proposalId, 'queued proposal should be discoverable');

    const approveReply = await api.commands.revenants.handler({
      args: `approve ${proposalId}`,
      senderId: '476437650849529856',
      sessionKey: 'agent:main:discord:channel:1473342935373447372',
    });
    assert.ok(approveReply.text.includes(`\`${proposalId}\``), 'approve command should confirm the reviewed proposal');

    const afterApprove = JSON.parse((await statusTool.execute({ action: 'peek', limit: 5 })).content[0].text);
    assert.strictEqual(afterApprove.queuedCount, 0, 'approved proposal should be removed from queue');

    console.log('✓ proposal notification validation passed');
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
      this.hooks[name] = handler;
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
