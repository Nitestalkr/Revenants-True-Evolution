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

  console.log('research translation validation passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
