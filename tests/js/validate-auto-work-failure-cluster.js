'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRevenantsObserver } = require('../../plugin/core/observer');

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-auto-work-failure-cluster-'));
  const observer = createRevenantsObserver({
    rootDir: path.join(tempRoot, 'state'),
    pluginConfig: {
      dataDir: path.join(tempRoot, 'state'),
      queueMemoryProposals: true,
      autoWorkEnabled: true,
      autoWorkMinIdleMs: 0,
      autoWorkCooldownMs: 60 * 60 * 1000,
      failureClusterThresholds: {
        default: 3,
      },
    },
  });

  await observer.start({});

  for (let index = 0; index < 3; index += 1) {
    observer.recordHook('after_tool_call', {
      sessionKey: 'agent:default:discord:channel:1234567890',
      sessionId: `session-${index + 1}`,
      toolName: 'exec',
      status: 'failed',
      error: 'temporary runtime fault',
      durationMs: 1200,
    }, {});
  }

  const queue = observer.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 1, 'clustered failures should queue exactly one proposal');
  const proposal = queue.recent[0];
  assert.ok(proposal, 'runtime proposal should be queued');
  assert.strictEqual(proposal.intent, 'stabilize-runtime');
  assert.strictEqual(proposal.proposalType, 'runtime');
  assert.ok(
    queue.recent.every((entry) => !String(entry.intent || '').startsWith('auto-work:failure-cluster:')),
    'failure-cluster auto-work proposal should be suppressed when runtime proposal already exists',
  );

  console.log('auto-work failure-cluster dedupe validation passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
