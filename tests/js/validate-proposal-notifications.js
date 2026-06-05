'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function main() {
  const plugin = (await import('../../plugin/index.mjs')).default;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-proposals-'));
  const sentPayloadFile = path.join(tempRoot, 'sent-payload.json');

  try {
    const api = createFakeApi({
      dataDir: path.join(tempRoot, 'state'),
      queueMemoryProposals: true,
      notifySessionOnProposal: true,
    }, sentPayloadFile);

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
    await api.hooks.after_tool_call({
      sessionId: 's-1b',
      sessionKey: 'agent:main:discord:channel:1473342935373447372',
      toolName: 'exec',
      status: 'failed',
      error: 'timeout',
      durationMs: 1200,
    }, {});

    await delay(200);

    const sentPayload = JSON.parse(fs.readFileSync(sentPayloadFile, 'utf8'));
    assert.strictEqual(sentPayload.channel, 'discord', 'proposal notification should route back to the active Discord channel');
    assert.strictEqual(sentPayload.target, 'channel:1473342935373447372', 'proposal notification should target the active Discord channel');
    assert.strictEqual(sentPayload.replyToId, '1511775773076230174', 'proposal notification should thread off the triggering message when available');
    const message = sentPayload.message;
    assert.ok(message.includes('Revenants proposal queued'), 'proposal notification should announce queued proposal');
    assert.ok(message.includes('revenants approve'), 'proposal notification should include in-chat approval guidance');
    assert.ok(message.includes('Type: runtime -> runtime-config'), 'proposal notification should include typed routing');
    assert.ok(message.includes('Apply path:'), 'proposal notification should include apply-path summary');

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
    assert.strictEqual(peek.recent[0]?.proposalType, 'runtime');
    assert.strictEqual(peek.recent[0]?.mutationTarget, 'runtime-config');

    const approveReply = await api.commands.revenants.handler({
      args: `approve ${proposalId}`,
      senderId: '476437650849529856',
      sessionKey: 'agent:main:discord:channel:1473342935373447372',
    });
    assert.ok(approveReply.text.includes(`\`${proposalId}\``), 'approve command should confirm the reviewed proposal');
    assert.ok(approveReply.text.includes('Routed as runtime -> runtime-config via config-patch.'), 'approve command should surface the route');

    const afterApprove = JSON.parse((await statusTool.execute({ action: 'peek', limit: 5 })).content[0].text);
    assert.strictEqual(afterApprove.queuedCount, 0, 'approved proposal should be removed from queue');

    console.log('✓ proposal notification validation passed');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function createFakeApi(pluginConfig, sentPayloadFile) {
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
    async sendMessage(payload) {
      fs.writeFileSync(sentPayloadFile, JSON.stringify(payload, null, 2));
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
