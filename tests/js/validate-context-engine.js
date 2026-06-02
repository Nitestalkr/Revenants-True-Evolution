'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRevenantsContextEngine } = require('../../plugin/core/context-engine');

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-context-'));
  const engine = createRevenantsContextEngine({
    pluginConfig: {
      dataDir: tempDir,
      injectContext: true,
      startMonitors: false,
    },
  });

  console.log('=== Revenants Context Engine Validation ===');

  const boot = await engine.bootstrap({ sessionId: 's1', sessionFile: path.join(tempDir, 'session.jsonl') });
  assert.strictEqual(boot.bootstrapped, true);
  pass('bootstrap returns bootstrapped');

  const ingest = await engine.ingest({
    sessionId: 's1',
    sessionKey: 'agent:test',
    message: { role: 'user', content: 'hello' },
  });
  assert.strictEqual(ingest.ingested, true);
  pass('ingest returns ingested');

  const assembled = await engine.assemble({
    sessionId: 's1',
    sessionKey: 'agent:test',
    messages: [{ role: 'user', content: 'hello' }],
    availableTools: new Set(['exec']),
    model: 'test/model',
  });
  assert.ok(assembled.systemPromptAddition.includes('Revenants Context'));
  assert.strictEqual(assembled.messages.length, 1);
  pass('assemble injects context');

  await engine.afterTurn({
    sessionId: 's1',
    sessionKey: 'agent:test',
    sessionFile: path.join(tempDir, 'session.jsonl'),
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '<tool_call>{}</tool_call>' },
    ],
    prePromptMessageCount: 1,
  });
  pass('afterTurn completes');

  const state = JSON.parse(fs.readFileSync(path.join(tempDir, 'data', 'context-state.json'), 'utf8'));
  assert.strictEqual(state.counters.messagesIngested, 1);
  assert.strictEqual(state.counters.turnsObserved, 1);
  assert.ok(state.grao.activeGradients.includes('tool-call-reliability'));
  pass('state updated with reliability gradient');

  const compact = await engine.compact({
    sessionId: 's1',
    sessionKey: 'agent:test',
    sessionFile: path.join(tempDir, 'session.jsonl'),
  });
  assert.strictEqual(compact.ok, true);
  pass('compact safely no-ops');

  await engine.dispose();
  console.log('=== Context engine validation passed ===');
}

function pass(message) {
  console.log(`  PASS: ${message}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
