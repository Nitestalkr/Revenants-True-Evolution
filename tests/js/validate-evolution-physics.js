'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRevenantsObserver } = require('../../plugin/core/observer');

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-evolution-physics-'));
  const observer = createRevenantsObserver({
    rootDir: path.join(tempRoot, 'state'),
    pluginConfig: {
      dataDir: path.join(tempRoot, 'state'),
      queueMemoryProposals: true,
      proposalMinImpact: 0.5,
      pressureThresholds: {
        runtime: 0.65,
      },
    },
  });

  await observer.start({});

  observer.recordTrace({
    id: 'runtime-low-pressure',
    timestamp: new Date().toISOString(),
    signalType: 'runtime',
    source: 'test',
    target: 'openclaw-runtime',
    action: 'monitor_alert',
    result: 'success',
    impactScore: 0.55,
    metadata: {
      status: 'minor drift',
    },
  });

  let queue = observer.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 0, 'low-pressure runtime signal should not queue a proposal');

  observer.recordTrace({
    id: 'runtime-high-pressure',
    timestamp: new Date().toISOString(),
    signalType: 'runtime',
    source: 'test',
    target: 'openclaw-runtime',
    action: 'monitor_alert',
    result: 'success',
    impactScore: 0.72,
    metadata: {
      status: 'sustained monitor pressure',
    },
  });

  queue = observer.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 1, 'high-pressure runtime signal should queue');
  assert.strictEqual(queue.recent.at(-1).proposalType, 'runtime');
  assert.ok(queue.recent.at(-1).physics?.pressure?.passed, 'queued proposal should expose pressure verdict');
  assert.ok(queue.recent.at(-1).validationRequired.includes('rollback'), 'runtime changes should retain rollback validation');
  assert.ok(queue.recent.at(-1).validationRequired.includes('human-review'), 'runtime changes should retain human review');

  const constrainedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-conservation-'));
  const constrainedObserver = createRevenantsObserver({
    rootDir: path.join(constrainedRoot, 'state'),
    pluginConfig: {
      dataDir: path.join(constrainedRoot, 'state'),
      queueMemoryProposals: true,
      conservation: {
        allowedMutationTargets: ['runtime-config'],
      },
      failureClusterThresholds: {
        policy: 1,
      },
    },
  });

  await constrainedObserver.start({});
  constrainedObserver.recordHook('after_tool_call', {
    sessionId: 'policy-1',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'exec',
    status: 'failed',
    error: 'blocked private address',
  }, {});

  queue = constrainedObserver.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 1, 'policy-shaped pressure should still surface');
  const conserved = queue.recent.at(-1);
  assert.strictEqual(conserved.proposalType, 'policy');
  assert.strictEqual(conserved.mutationTarget, 'AGENTS.md');
  assert.strictEqual(conserved.applyMode, 'blocked');
  assert.ok(conserved.validationRequired.includes('conservation-law'));
  assert.ok(conserved.physics?.conservation?.violations?.length > 0, 'conservation law should record reroute reason');

  const review = constrainedObserver.reviewQueue('approve', {
    ids: [conserved.id],
    reviewer: 'tester',
  });
  assert.strictEqual(review.appliedMutations.at(-1).status, 'blocked');
  assert.strictEqual(
    constrainedObserver.store.readImplementationTasks(10).length,
    0,
    'blocked conservation proposal must not become implementation work',
  );

  const autoWorkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-autowork-conservation-'));
  const autoWorkObserver = createRevenantsObserver({
    rootDir: path.join(autoWorkRoot, 'state'),
    pluginConfig: {
      dataDir: path.join(autoWorkRoot, 'state'),
      queueMemoryProposals: true,
      autoWorkEnabled: true,
      autoWorkMinIdleMs: 0,
      conservation: {
        allowedMutationTargets: ['runtime-config'],
      },
    },
  });

  await autoWorkObserver.start({});
  autoWorkObserver.store.appendImplementationTask({
    proposalId: 'manual-task-1',
    createdAt: new Date().toISOString(),
    summary: 'Existing implementation backlog should be considered for auto-work.',
    mutationTarget: 'implementation-task',
  });
  autoWorkObserver.recordHook('session_end', {
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    sessionId: 'session-auto-1',
    status: 'success',
  }, {});

  queue = autoWorkObserver.reviewQueue('peek', { limit: 10 });
  const autoWork = queue.recent.find((entry) => String(entry.intent || '').startsWith('auto-work:'));
  assert.ok(autoWork, 'auto-work pressure should still queue for manual review');
  assert.strictEqual(autoWork.applyMode, 'blocked');
  assert.strictEqual(autoWork.mutationTarget, 'implementation-task');
  assert.ok(autoWork.physics?.pressure?.passed, 'auto-work should include pressure metadata');
  assert.ok(autoWork.physics?.conservation?.violations?.length > 0, 'auto-work should pass through conservation law');

  console.log('evolution physics validation passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
