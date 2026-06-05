'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRevenantsObserver } = require('../../plugin/core/observer');

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-apply-'));
  const mutationRoot = path.join(tempRoot, 'workspace');
  fs.mkdirSync(mutationRoot, { recursive: true });
  fs.writeFileSync(path.join(mutationRoot, 'AGENTS.md'), '# Agent Notes\n');
  fs.writeFileSync(path.join(mutationRoot, 'TOOLS.md'), '# Tools\n');

  const observer = createRevenantsObserver({
    rootDir: path.join(tempRoot, 'state'),
    pluginConfig: {
      dataDir: path.join(tempRoot, 'state'),
      mutationRoot,
      queueMemoryProposals: true,
    },
  });

  await observer.start({});

  observer.recordHook('after_tool_call', {
    sessionId: 's-1',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'web_fetch',
    status: 'failed',
    error: 'blocked private address',
  }, {});
  observer.recordHook('after_tool_call', {
    sessionId: 's-1b',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'web_fetch',
    status: 'failed',
    error: 'blocked private address',
  }, {});

  let queue = observer.reviewQueue('peek', { limit: 5 });
  const toolingProposal = queue.recent.at(-1);
  assert.ok(toolingProposal, 'tooling proposal should exist');
  assert.strictEqual(toolingProposal.mutationTarget, 'TOOLS.md');

  const approveTooling = observer.reviewQueue('approve', {
    ids: [toolingProposal.id],
    reviewer: 'tester',
  });
  assert.strictEqual(approveTooling.appliedMutations[0]?.status, 'applied');
  const toolsBody = fs.readFileSync(path.join(mutationRoot, 'TOOLS.md'), 'utf8');
  assert.ok(toolsBody.includes(toolingProposal.id), 'approved tooling proposal should append to TOOLS.md');

  observer.recordHook('after_tool_call', {
    sessionId: 's-policy',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'exec',
    status: 'failed',
    error: 'blocked private address',
  }, {});

  queue = observer.reviewQueue('peek', { limit: 5 });
  const policyProposal = queue.recent.at(-1);
  assert.ok(policyProposal, 'policy proposal should exist');
  assert.strictEqual(policyProposal.mutationTarget, 'AGENTS.md');

  const approvePolicy = observer.reviewQueue('approve', {
    ids: [policyProposal.id],
    reviewer: 'tester',
  });
  assert.strictEqual(approvePolicy.appliedMutations[0]?.status, 'applied');
  const agentsBody = fs.readFileSync(path.join(mutationRoot, 'AGENTS.md'), 'utf8');
  assert.ok(agentsBody.includes(policyProposal.id), 'approved policy proposal should append to AGENTS.md');

  observer.recordHook('after_tool_call', {
    sessionId: 's-2',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'exec',
    status: 'failed',
    error: 'timeout contacting upstream',
  }, {});

  observer.recordHook('after_tool_call', {
    sessionId: 's-2b',
    sessionKey: 'agent:main:discord:channel:1473342935373447372',
    toolName: 'exec',
    status: 'failed',
    error: 'timeout contacting upstream',
  }, {});

  queue = observer.reviewQueue('peek', { limit: 5 });
  const runtimeProposal = queue.recent.at(-1);
  assert.ok(runtimeProposal, 'runtime proposal should exist');
  assert.strictEqual(runtimeProposal.mutationTarget, 'runtime-config');

  const approveRuntime = observer.reviewQueue('approve', {
    ids: [runtimeProposal.id],
    reviewer: 'tester',
  });
  assert.strictEqual(approveRuntime.appliedMutations[0]?.status, 'applied');

  const runtimeConfig = observer.store.readRuntimeConfig();
  assert.strictEqual(runtimeConfig.toolPolicies.exec.recommendedHandling, 'increase-timeout-and-retry-carefully');
  assert.strictEqual(runtimeConfig.appliedProposals[runtimeProposal.id].target, 'runtime-config');

  const applied = observer.store.readAppliedMutations(10);
  assert.ok(applied.length >= 2, 'applied mutations should be recorded');

  console.log('proposal application validation passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
