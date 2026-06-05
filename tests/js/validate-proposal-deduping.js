'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRevenantsObserver } = require('../../plugin/core/observer');

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-dedupe-'));
  const mutationRoot = path.join(tempRoot, 'workspace');
  fs.mkdirSync(mutationRoot, { recursive: true });
  fs.writeFileSync(path.join(mutationRoot, 'AGENTS.md'), '# Agent Notes\n');
  const observer = createRevenantsObserver({
    rootDir: path.join(tempRoot, 'state'),
    pluginConfig: {
      dataDir: path.join(tempRoot, 'state'),
      mutationRoot,
      queueMemoryProposals: true,
      proposalCooldownMs: 60 * 60 * 1000,
    },
  });

  await observer.start({});

  observer.recordHook('after_tool_call', {
    sessionId: 's-1',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'web_fetch',
    status: 'failed',
    error: 'blocked private address',
  }, {});

  let queue = observer.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 1, 'first policy failure should queue one proposal');

  observer.recordHook('after_tool_call', {
    sessionId: 's-2',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'web_fetch',
    status: 'failed',
    error: 'blocked private address',
  }, {});

  queue = observer.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 1, 'identical policy proposal should be suppressed during cooldown');

  observer.recordHook('after_tool_call', {
    sessionId: 's-3',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'web_fetch',
    status: 'failed',
    error: 'timeout contacting upstream',
  }, {});

  queue = observer.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 1, 'single transient runtime failure should not queue a new proposal yet');

  observer.recordHook('after_tool_call', {
    sessionId: 's-3b',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'web_fetch',
    status: 'failed',
    error: 'timeout contacting upstream',
  }, {});

  queue = observer.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 2, 'clustered runtime failure should queue a distinct proposal');

  const firstId = queue.recent[0].id;
  observer.reviewQueue('approve', {
    ids: [firstId],
    reviewer: 'tester',
  });

  observer.recordHook('after_tool_call', {
    sessionId: 's-4',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'web_fetch',
    status: 'failed',
    error: 'blocked private address',
  }, {});

  queue = observer.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 1, 'recently approved duplicate should stay suppressed during cooldown');

  console.log('proposal deduping validation passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
