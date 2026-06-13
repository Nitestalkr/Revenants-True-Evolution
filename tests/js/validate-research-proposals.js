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
      title: 'GRAM: A Global Workspace Agent Architecture for Tool Use',
      summary: 'We present an agentic cognitive architecture with global workspace coordination, gradient routing, salience broadcast, tool use, and evaluation benchmarks.',
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
  assert.strictEqual(proposal.researchAssessment.sourcePaper.title, 'GRAM: A Global Workspace Agent Architecture for Tool Use');
  assert.deepStrictEqual(proposal.researchAssessment.frameworks, ['GRAM']);
  assert.strictEqual(proposal.researchAssessment.primaryFramework, 'GRAM');
  assert.ok(proposal.researchAssessment.landingZones.includes('plugin/core/observer.js'));
  assert.ok(proposal.researchAssessment.landingZones.includes('plugin/core/trace-normalizer.js'));
  assert.deepStrictEqual(proposal.researchAssessment.gradientTargets, ['salience-broadcast', 'proposal-routing']);
  assert.strictEqual(proposal.researchAssessment.deliberationProfile.mode, 'salience-first');
  assert.strictEqual(proposal.researchAssessment.expectedImpact, 'high');
  assert.strictEqual(proposal.researchAssessment.suggestedMutationTarget, 'implementation-task');
  const state = observer.store.readState();
  assert.ok(state.grao.activeGradients.includes('salience-broadcast'));
  assert.ok(state.grao.activeGradients.includes('proposal-routing'));

  const genericRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-research-generic-'));
  const genericObserver = createRevenantsObserver({
    rootDir: genericRootDir,
    pluginConfig: {
      dataDir: genericRootDir,
      queueMemoryProposals: true,
    },
  });

  await genericObserver.start({});

  genericObserver.recordTrace({
    id: 'generic-research-trace',
    timestamp: new Date().toISOString(),
    signalType: 'research',
    source: 'openclaw-hook',
    action: 'monitor_alert',
    result: 'success',
    impactScore: 0.82,
    metadata: {
      alertType: 'arxiv_paper',
      paper: {
        id: 'http://arxiv.org/abs/2506.33333',
        title: 'A Framework for Broadcast Gating in Agent Systems',
        summary: 'This benchmark studies framework behavior, broadcast reliability, and gating under generic orchestration workloads.',
        published: '2026-06-01T00:00:00Z',
        authors: ['Generic Author'],
      },
    },
  });

  const genericProposal = genericObserver.reviewQueue('peek', { limit: 5 }).recent.at(-1);
  assert.ok(genericProposal, 'generic research proposal should be queued');
  assert.deepStrictEqual(genericProposal.researchAssessment.frameworks, []);
  const genericState = genericObserver.store.readState();
  assert.ok(!genericState.grao.activeGradients.includes('salience-broadcast'));
  assert.ok(!genericState.grao.activeGradients.includes('review-gating'));

  console.log('research proposal validation passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
