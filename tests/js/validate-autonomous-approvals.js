'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRevenantsObserver } = require('../../plugin/core/observer');

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-autonomous-'));
  const mutationRoot = path.join(tempRoot, 'workspace');
  fs.mkdirSync(mutationRoot, { recursive: true });
  fs.writeFileSync(path.join(mutationRoot, 'AGENTS.md'), '# Agent Notes\n');

  const observer = createRevenantsObserver({
    rootDir: path.join(tempRoot, 'state'),
    pluginConfig: {
      dataDir: path.join(tempRoot, 'state'),
      mutationRoot,
      queueMemoryProposals: true,
      autonomousApprovals: true,
    },
  });

  await observer.start({});

  observer.recordHook('after_tool_call', {
    sessionId: 'runtime-1',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'exec',
    status: 'failed',
    error: 'timeout contacting upstream',
  }, {});
  observer.recordHook('after_tool_call', {
    sessionId: 'runtime-2',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'exec',
    status: 'failed',
    error: 'timeout contacting upstream',
  }, {});

  let queue = observer.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 0, 'autonomous approval should remove eligible runtime proposal from queue');

  const reviewed = observer.store.readReviewedPromotions(10);
  const autonomousRuntime = reviewed.find((entry) => entry?.reviewMeta?.reviewer === 'revenants-autonomy');
  assert.ok(autonomousRuntime, 'autonomous approval should be recorded as a review');
  assert.strictEqual(autonomousRuntime.mutationTarget, 'runtime-config');
  assert.strictEqual(autonomousRuntime.autoApplyEligible, true);
  assert.ok(!autonomousRuntime.validationRequired.includes('human-review'), 'autonomous runtime proposal should not require human review');

  const runtimeConfig = observer.store.readRuntimeConfig();
  assert.strictEqual(
    runtimeConfig.appliedProposals[autonomousRuntime.id].target,
    'runtime-config',
    'autonomously approved runtime proposal should apply',
  );

  observer.recordHook('after_tool_call', {
    sessionId: 'policy-1',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'exec',
    status: 'failed',
    error: 'blocked private address',
  }, {});

  queue = observer.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 1, 'sensitive policy proposal should stay queued under autonomy');
  const policyProposal = queue.recent.at(-1);
  assert.strictEqual(policyProposal.mutationTarget, 'AGENTS.md');
  assert.strictEqual(policyProposal.autoApplyEligible, false);
  assert.ok(policyProposal.validationRequired.includes('human-review'));
  assert.ok(policyProposal.validationRequired.includes('conservation-law'));

  const agentsBody = fs.readFileSync(path.join(mutationRoot, 'AGENTS.md'), 'utf8');
  assert.ok(!agentsBody.includes(policyProposal.id), 'autonomy must not mutate AGENTS.md by default');

  observer.recordHook('monitor_alert', {
    type: 'arxiv_paper',
    paper: {
      id: 'http://arxiv.org/abs/2506.77777',
      title: 'LDT: Layered Deliberation Thresholds for Runtime Escalation',
      summary: 'We describe staged review, confidence gates, runtime escalation thresholds, and bounded follow-up policy for agent proposals.',
      published: '2026-06-04T00:00:00Z',
      authors: ['Autonomy Researcher'],
    },
  }, {});

  queue = observer.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 1, 'policy proposal should remain queued while autonomous research follow-up applies');
  const applied = observer.store.readAppliedMutations(20);
  assert.ok(
    applied.some((entry) => entry.status === 'translated' && entry.translatedProposalId),
    'autonomous research proposal should translate',
  );
  assert.ok(
    applied.some((entry) => entry.status === 'applied' && entry.mutationTarget === 'runtime-config'),
    'autonomous translated runtime follow-up should apply',
  );

  const blockedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-autonomous-blocked-'));
  const blockedObserver = createRevenantsObserver({
    rootDir: path.join(blockedRoot, 'state'),
    pluginConfig: {
      dataDir: path.join(blockedRoot, 'state'),
      queueMemoryProposals: true,
      autonomousApprovals: true,
      conservation: {
        allowedMutationTargets: ['runtime-config'],
      },
      failureClusterThresholds: {
        policy: 1,
      },
    },
  });

  await blockedObserver.start({});
  blockedObserver.recordHook('after_tool_call', {
    sessionId: 'blocked-policy-1',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'exec',
    status: 'failed',
    error: 'blocked private address',
  }, {});

  queue = blockedObserver.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 1, 'conservation-blocked proposal should stay queued');
  assert.strictEqual(queue.recent.at(-1).applyMode, 'blocked');
  assert.strictEqual(queue.recent.at(-1).autoApplyEligible, false);

  console.log('autonomous approvals validation passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
