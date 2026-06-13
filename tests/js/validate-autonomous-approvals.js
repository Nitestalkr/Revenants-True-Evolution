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
  fs.writeFileSync(path.join(mutationRoot, 'TOOLS.md'), '# Tools\n');

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
    sessionId: 'tooling-1',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'web_fetch',
    status: 'failed',
    error: 'blocked private address',
  }, {});
  observer.recordHook('after_tool_call', {
    sessionId: 'tooling-2',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'web_fetch',
    status: 'failed',
    error: 'blocked private address',
  }, {});

  let queue = observer.reviewQueue('peek', { limit: 10 });
  assert.strictEqual(queue.queuedCount, 0, 'autonomous approval should remove eligible tooling proposal from queue');

  const reviewed = observer.store.readReviewedPromotions(10);
  const autonomousTooling = reviewed.find((entry) => entry?.reviewMeta?.reviewer === 'revenants-autonomy');
  assert.ok(autonomousTooling, 'autonomous approval should be recorded as a review');
  assert.strictEqual(autonomousTooling.autoApplyEligible, true);
  assert.ok(!autonomousTooling.validationRequired.includes('human-review'), 'autonomous proposal should not require human review');

  const toolsBody = fs.readFileSync(path.join(mutationRoot, 'TOOLS.md'), 'utf8');
  assert.ok(toolsBody.includes(autonomousTooling.id), 'autonomously approved tooling proposal should apply');

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
  assert.strictEqual(queue.queuedCount, 0, 'autonomous research translation follow-up should also apply');
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
