'use strict';

const assert = require('assert');
const { buildPromotion } = require('../../plugin/core/trace-normalizer');

function main() {
  const policyPromotion = buildPromotion({
    id: 'trace-policy',
    timestamp: new Date().toISOString(),
    signalType: 'tooling',
    source: 'openclaw-hook',
    action: 'after_tool_call',
    result: 'failure',
    impactScore: 0.8,
    metadata: {
      toolName: 'web_fetch',
      error: 'blocked private address',
    },
  });

  assert.strictEqual(policyPromotion.proposalType, 'policy');
  assert.strictEqual(policyPromotion.mutationTarget, 'AGENTS.md');
  assert.strictEqual(policyPromotion.applyMode, 'doc-patch');
  assert.deepStrictEqual(policyPromotion.validationRequired, ['human-review']);

  const runtimePromotion = buildPromotion({
    id: 'trace-runtime',
    timestamp: new Date().toISOString(),
    signalType: 'tooling',
    source: 'openclaw-hook',
    action: 'after_tool_call',
    result: 'failure',
    impactScore: 0.8,
    metadata: {
      toolName: 'web_fetch',
      error: 'timeout contacting upstream',
    },
  });

  assert.strictEqual(runtimePromotion.proposalType, 'runtime');
  assert.strictEqual(runtimePromotion.mutationTarget, 'runtime-config');
  assert.strictEqual(runtimePromotion.applyMode, 'config-patch');
  assert.deepStrictEqual(runtimePromotion.validationRequired, ['schema', 'rollback', 'human-review']);

  const memoryPromotion = buildPromotion({
    id: 'trace-memory',
    timestamp: new Date().toISOString(),
    signalType: 'memory',
    source: 'openclaw-hook',
    action: 'after_compaction',
    result: 'partial',
    impactScore: 0.7,
    metadata: {},
  });

  assert.strictEqual(memoryPromotion.proposalType, 'memory');
  assert.strictEqual(memoryPromotion.mutationTarget, 'MEMORY.md');
  assert.strictEqual(memoryPromotion.applyMode, 'memory-update');

  const researchPromotion = buildPromotion({
    id: 'trace-research',
    timestamp: new Date().toISOString(),
    signalType: 'research',
    source: 'openclaw-hook',
    action: 'monitor_alert',
    result: 'success',
    impactScore: 0.82,
    metadata: {
      alertType: 'arxiv_paper',
      paper: {
        id: 'http://arxiv.org/abs/2506.12345',
        title: 'Attention Schema Tool Use Benchmarks',
        summary: 'An agentic benchmark for attention schema and tool use evaluation.',
        published: '2026-06-01T00:00:00Z',
        authors: ['A. Researcher'],
      },
    },
  });

  assert.strictEqual(researchPromotion.proposalType, 'research');
  assert.strictEqual(researchPromotion.mutationTarget, 'research-review');
  assert.strictEqual(researchPromotion.applyMode, 'proposal-only');
  assert.strictEqual(researchPromotion.researchAssessment.sourcePaper.title, 'Attention Schema Tool Use Benchmarks');
  assert.strictEqual(researchPromotion.researchAssessment.expectedImpact, 'high');

  console.log('proposal routing validation passed');
}

main();
