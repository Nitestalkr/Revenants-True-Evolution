'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRevenantsObserver } = require('../../plugin/core/observer');

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-failure-pressure-'));
  const observer = createRevenantsObserver({
    rootDir: path.join(tempRoot, 'state'),
    pluginConfig: {
      dataDir: path.join(tempRoot, 'state'),
      queueMemoryProposals: true,
      failureClusterWindowMs: 60 * 60 * 1000,
    },
  });

  await observer.start({});

  observer.recordHook('after_tool_call', {
    sessionId: 'timeout-1',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'exec',
    status: 'failed',
    error: 'timeout contacting upstream',
  }, {});

  let queue = observer.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 0, 'single transient timeout should not queue a proposal');

  observer.recordHook('after_tool_call', {
    sessionId: 'timeout-2',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'exec',
    status: 'failed',
    error: 'timeout contacting upstream',
  }, {});

  queue = observer.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 1, 'clustered timeout should queue one runtime proposal');
  assert.strictEqual(queue.recent.at(-1).proposalType, 'runtime');

  observer.recordHook('after_tool_call', {
    sessionId: 'policy-1',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'web_fetch',
    status: 'failed',
    error: 'blocked private address',
  }, {});

  queue = observer.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 1, 'single web_fetch access-constraint failure should not queue immediately');

  observer.recordHook('after_tool_call', {
    sessionId: 'policy-2',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'web_fetch',
    status: 'failed',
    error: 'blocked private address',
  }, {});

  queue = observer.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 2, 'clustered web_fetch access-constraint failures should queue one tooling proposal');
  assert.strictEqual(queue.recent.at(-1).proposalType, 'tooling');
  assert.strictEqual(queue.recent.at(-1).mutationTarget, 'TOOLS.md');

  observer.recordHook('after_tool_call', {
    sessionId: 'policy-3',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'exec',
    status: 'failed',
    error: 'blocked private address',
  }, {});

  queue = observer.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 3, 'true policy-shaped tool failures should still surface immediately');
  assert.strictEqual(queue.recent.at(-1).proposalType, 'policy');

  console.log('failure pressure validation passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
