'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRevenantsObserver } = require('../../plugin/core/observer');

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-auto-work-'));
  const observer = createRevenantsObserver({
    rootDir: path.join(tempRoot, 'state'),
    pluginConfig: {
      dataDir: path.join(tempRoot, 'state'),
      queueMemoryProposals: true,
      autoWorkEnabled: true,
      autoWorkMinIdleMs: 0,
      autoWorkCooldownMs: 60 * 60 * 1000,
    },
  });

  await observer.start({});

  observer.recordHook('message_received', {
    sessionKey: 'agent:default:discord:channel:1234567890',
    sessionId: 'session-1',
    channel: 'discord',
    channelId: '1234567890',
    senderId: '476437650849529856',
    messageId: 'msg-1',
    status: 'success',
  }, {});

  observer.recordHook('monitor_alert', {
    type: 'arxiv_paper',
    sessionKey: 'agent:default:discord:channel:1234567890',
    paper: {
      id: 'http://arxiv.org/abs/2506.12345',
      title: 'A Global Workspace Agent Architecture for Tool Use',
      summary: 'We present an agentic cognitive architecture with global workspace coordination, tool use, and evaluation benchmarks.',
      published: '2026-06-01T00:00:00Z',
      authors: ['Jane Doe', 'John Smith'],
    },
  }, {});

  const before = observer.reviewQueue('peek', { limit: 10 });
  const researchProposal = before.recent.at(-1);
  assert.ok(researchProposal, 'research proposal should be queued');

  observer.reviewQueue('approve', {
    ids: [researchProposal.id],
    reviewer: 'tester',
  });

  const afterTranslate = observer.reviewQueue('peek', { limit: 10 });
  const translatedFollowUp = afterTranslate.recent.at(-1);
  assert.ok(translatedFollowUp, 'translated follow-up should exist');
  assert.strictEqual(translatedFollowUp.proposalType, 'implementation');

  observer.recordHook('session_end', {
    sessionKey: 'agent:default:discord:channel:1234567890',
    sessionId: 'session-1',
    status: 'success',
  }, {});

  const afterAutoWork = observer.reviewQueue('peek', { limit: 10 });
  const autoWork = afterAutoWork.recent.find((entry) => String(entry.intent || '').startsWith('auto-work:'));
  assert.ok(autoWork, 'auto-work proposal should be queued from observer pressure');
  assert.strictEqual(autoWork.proposalType, 'implementation');
  assert.strictEqual(autoWork.mutationTarget, 'implementation-task');
  assert.strictEqual(autoWork.applyMode, 'task');
  assert.match(autoWork.summary, /translated follow-up|implementation work/i);

  observer.recordHook('session_end', {
    sessionKey: 'agent:default:discord:channel:1234567890',
    sessionId: 'session-1',
    status: 'success',
  }, {});

  const afterRepeat = observer.reviewQueue('peek', { limit: 20 });
  const autoWorkCount = afterRepeat.recent.filter((entry) => String(entry.intent || '').startsWith('auto-work:')).length;
  assert.strictEqual(autoWorkCount, 1, 'repeat trigger should not spam duplicate auto-work proposals');

  console.log('auto-work proposal validation passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
