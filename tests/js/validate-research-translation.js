'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRevenantsObserver } = require('../../plugin/core/observer');

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-research-translate-'));
  const observer = createRevenantsObserver({
    rootDir: path.join(tempRoot, 'state'),
    pluginConfig: {
      dataDir: path.join(tempRoot, 'state'),
      queueMemoryProposals: true,
    },
  });

  await observer.start({});

  observer.recordHook('monitor_alert', {
    type: 'arxiv_paper',
    paper: {
      id: 'http://arxiv.org/abs/2506.22345',
      title: 'LDT: Layered Deliberation Thresholds for Runtime Escalation',
      summary: 'We describe staged review, confidence gates, runtime escalation thresholds, and bounded follow-up policy for agent proposals.',
      published: '2026-06-02T00:00:00Z',
      authors: ['June Roe', 'Max Smith'],
    },
  }, {});

  const before = observer.reviewQueue('peek', { limit: 5 });
  const researchProposal = before.recent.at(-1);
  assert.ok(researchProposal, 'research proposal should be queued');
  assert.strictEqual(researchProposal.proposalType, 'research');
  assert.deepStrictEqual(researchProposal.researchAssessment.frameworks, ['LDT']);
  assert.strictEqual(researchProposal.researchAssessment.suggestedMutationTarget, 'runtime-config');

  const approve = observer.reviewQueue('approve', {
    ids: [researchProposal.id],
    reviewer: 'tester',
  });
  assert.strictEqual(approve.appliedMutations[0]?.status, 'translated');
  assert.ok(approve.appliedMutations[0]?.translatedProposalId, 'translated follow-up id should be returned');

  const after = observer.reviewQueue('peek', { limit: 5 });
  const followUp = after.recent.at(-1);
  assert.ok(followUp, 'translated follow-up proposal should be queued');
  assert.strictEqual(followUp.id, approve.appliedMutations[0].translatedProposalId);
  assert.strictEqual(followUp.proposalType, 'runtime');
  assert.strictEqual(followUp.mutationTarget, 'runtime-config');
  assert.strictEqual(followUp.applyMode, 'config-patch');
  assert.deepStrictEqual(followUp.researchAssessment.frameworks, ['LDT']);

  const applied = observer.store.readAppliedMutations(5);
  assert.strictEqual(applied.at(-1).translatedProposalId, followUp.id);

  const constrainedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-research-translate-constrained-'));
  const constrainedObserver = createRevenantsObserver({
    rootDir: path.join(constrainedRoot, 'state'),
    pluginConfig: {
      dataDir: path.join(constrainedRoot, 'state'),
      queueMemoryProposals: true,
      conservation: {
        allowedMutationTargets: ['research-review'],
      },
    },
  });

  await constrainedObserver.start({});
  constrainedObserver.recordHook('monitor_alert', {
    type: 'arxiv_paper',
    paper: {
      id: 'http://arxiv.org/abs/2506.44556',
      title: 'LDT: Layered Deliberation Thresholds for Safety Governance',
      summary: 'We describe staged review, confidence gates, constitutional alignment, policy governance, and conservative escalation controls.',
      published: '2026-06-03T00:00:00Z',
      authors: ['Ada Researcher'],
    },
  }, {});

  const constrainedResearch = constrainedObserver.reviewQueue('peek', { limit: 5 }).recent.at(-1);
  assert.ok(constrainedResearch, 'constrained research proposal should be queued');
  assert.strictEqual(constrainedResearch.mutationTarget, 'research-review');
  assert.ok(constrainedResearch.physics?.conservation?.passed, 'initial research-review proposal should satisfy conservation');

  const constrainedApprove = constrainedObserver.reviewQueue('approve', {
    ids: [constrainedResearch.id],
    reviewer: 'tester',
  });
  assert.strictEqual(constrainedApprove.appliedMutations[0]?.status, 'translated');

  const constrainedFollowUp = constrainedObserver.reviewQueue('peek', { limit: 5 }).recent.at(-1);
  assert.ok(constrainedFollowUp, 'constrained translated follow-up should still surface for review');
  assert.strictEqual(constrainedFollowUp.id, constrainedApprove.appliedMutations[0].translatedProposalId);
  assert.strictEqual(constrainedFollowUp.mutationTarget, 'AGENTS.md');
  assert.strictEqual(constrainedFollowUp.applyMode, 'blocked');
  assert.ok(constrainedFollowUp.physics?.pressure?.passed, 'translated follow-up should include pressure metadata');
  assert.strictEqual(constrainedFollowUp.physics?.conservation?.passed, false);
  assert.ok(
    constrainedFollowUp.physics?.conservation?.violations?.some((violation) => violation.value === 'AGENTS.md'),
    'translated follow-up should record the forbidden AGENTS.md target',
  );

  console.log('research translation validation passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
