'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRevenantsObserver } = require('../../plugin/core/observer');

async function main() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-research-'));
  const observer = createRevenantsObserver({
    rootDir,
    pluginConfig: {
      dataDir: rootDir,
      queueMemoryProposals: true,
    },
  });

  await observer.start({});

  observer.recordHook('monitor_alert', {
    type: 'arxiv_paper',
    paper: {
      id: 'http://arxiv.org/abs/2506.12345',
      title: 'A Global Workspace Agent Architecture for Tool Use',
      summary: 'We present an agentic cognitive architecture with global workspace coordination, tool use, and evaluation benchmarks.',
      published: '2026-06-01T00:00:00Z',
      authors: ['Jane Doe', 'John Smith'],
    },
    ts: '2026-06-03T20:30:00.000Z',
  }, {});

  const peek = observer.reviewQueue('peek', { limit: 5 });
  const proposal = peek.recent.at(-1);

  assert.ok(proposal, 'research proposal should be queued');
  assert.strictEqual(proposal.proposalType, 'research');
  assert.strictEqual(proposal.mutationTarget, 'research-review');
  assert.strictEqual(proposal.applyMode, 'proposal-only');
  assert.deepStrictEqual(proposal.validationRequired, ['human-review', 'source-check']);
  assert.strictEqual(proposal.researchAssessment.sourcePaper.title, 'A Global Workspace Agent Architecture for Tool Use');
  assert.strictEqual(proposal.researchAssessment.expectedImpact, 'high');
  assert.strictEqual(proposal.researchAssessment.suggestedMutationTarget, 'implementation-task');

  console.log('research proposal validation passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
