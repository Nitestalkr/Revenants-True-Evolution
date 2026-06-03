'use strict';

const DataStore = require('./data-store');
const MonitorSuite = require('../monitors/monitor-suite');
const { normalizeMessageTrace, normalizeTurnTrace } = require('./trace-normalizer');
const { resolveRuntimeRoot } = require('./storage-paths');

function createRevenantsContextEngine(ctx = {}) {
  return new RevenantsContextEngine(ctx);
}

class RevenantsContextEngine {
  constructor(ctx = {}) {
    this.ctx = ctx;
    this.rootDir = resolveRuntimeRoot(ctx.pluginConfig || {});
    this.injectContext = ctx.pluginConfig?.injectContext === true;
    this.startMonitors = ctx.pluginConfig?.startMonitors === true;
    this.store = new DataStore(this.rootDir);
    this.suite = null;

    this.info = {
      id: 'revenants',
      name: 'Revenants Context Engine',
      version: '0.1.0',
      ownsCompaction: false,
      turnMaintenanceMode: 'background',
      hostRequirements: {
        'agent-run': {
          requiredCapabilities: ['assemble-before-prompt', 'after-turn'],
          unsupportedMessage: 'Revenants needs assemble + afterTurn to inject GNW/GRAO state and capture traces.',
        },
      },
    };
  }

  async bootstrap() {
    this.store.ensure();
    if (this.startMonitors && !this.suite) {
      this.suite = new MonitorSuite({ dataDir: this.rootDir });
      this.suite.start();
    }
    return { bootstrapped: true };
  }

  async ingest(params) {
    const trace = normalizeMessageTrace(params);
    this.store.appendTrace(trace);
    this.store.updateState((state) => {
      state.counters.messagesIngested += 1;
      return state;
    });
    return { ingested: true };
  }

  async ingestBatch(params) {
    let count = 0;
    for (const message of params.messages || []) {
      await this.ingest({ ...params, message });
      count += 1;
    }
    return { ingestedCount: count };
  }

  async assemble(params) {
    const state = this.store.readState();
    const systemPromptAddition = this.injectContext ? buildContextBlock(state, {
      availableTools: params.availableTools,
      model: params.model,
    }) : undefined;

    return {
      messages: params.messages,
      estimatedTokens: estimateTokens(params.messages, systemPromptAddition),
      promptAuthority: 'assembled',
      systemPromptAddition,
      contextProjection: {
        mode: 'per_turn',
        fingerprint: String(state.updatedAt || ''),
      },
    };
  }

  async afterTurn(params) {
    const trace = normalizeTurnTrace(params);
    this.store.appendTrace(trace);
    this.store.updateState((state) => {
      state.cycleCount += 1;
      state.counters.turnsObserved += 1;
      state.counters.toolCallsObserved += trace.toolCalls.attempted;
      state.counters.toolFailuresObserved += trace.toolCalls.failed;
      updateDriveScores(state, trace);
      updateGraoSignals(state, trace);
      return state;
    });
  }

  async maintain() {
    return { changed: false, bytesFreed: 0, rewrittenEntries: 0, reason: 'revenants-maintain-observe-only' };
  }

  async compact() {
    const traces = this.store.tailTraces(50);
    this.store.updateState((state) => {
      state.lastCompactAt = new Date().toISOString();
      state.lastCompactTraceCount = traces.length;
      return state;
    });
    return {
      ok: true,
      compacted: false,
      reason: 'revenants-does-not-own-transcript-compaction-yet',
    };
  }

  async dispose() {
    if (this.suite) {
      this.suite.stop();
      this.suite = null;
    }
  }
}

function buildContextBlock(state, opts = {}) {
  const scores = state.driveScores || {};
  const topDrive = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] || 'competence';
  const gradients = state.grao?.activeGradients || [];
  const proposals = state.grao?.activeProposals || [];
  const toolFailures = state.counters?.toolFailuresObserved || 0;
  const toolCalls = state.counters?.toolCallsObserved || 0;

  return [
    '## Revenants Context',
    `Top GNW drive: ${topDrive}`,
    `Drive scores: curiosity=${fmt(scores.curiosity)}, helpfulness=${fmt(scores.helpfulness)}, competence=${fmt(scores.competence)}, safety=${fmt(scores.safety)}, goal_directed=${fmt(scores.goal_directed)}`,
    `Tool reliability observed: ${toolCalls - toolFailures}/${toolCalls} successful tool results`,
    gradients.length ? `Active GRAO gradients: ${gradients.join(', ')}` : 'Active GRAO gradients: none yet',
    proposals.length ? `Queued GRAO proposals: ${proposals.join(', ')}` : 'Queued GRAO proposals: none yet',
    'Policy: collect data deterministically; use agent turns for analysis and decisions; do not mutate external systems from this context block alone.',
    opts.availableTools?.has?.('exec') ? 'Execution tools are available; prefer proof-of-execution traces for diagnostics.' : 'Execution tools are not visible in this run.',
    '',
  ].join('\n');
}

function updateDriveScores(state, trace) {
  const scores = state.driveScores;
  if (trace.toolCalls.failed > 0 || trace.toolCalls.leakedAsText > 0) {
    scores.competence = clamp(scores.competence + 0.08);
    scores.safety = clamp(scores.safety + 0.05);
  } else {
    scores.competence = clamp(scores.competence + 0.01);
  }
  if (trace.signalType === 'user_interaction') scores.helpfulness = clamp(scores.helpfulness + 0.05);
}

function updateGraoSignals(state, trace) {
  const gradients = new Set(state.grao.activeGradients || []);
  if (trace.toolCalls.failed > 0 || trace.toolCalls.leakedAsText > 0) gradients.add('tool-call-reliability');
  if (trace.toolCalls.attempted > 0) gradients.add('trace-density');
  state.grao.activeGradients = [...gradients].slice(-10);
  if (trace.toolCalls.failed > 0) state.grao.knownFailureCount += trace.toolCalls.failed;
  state.grao.activeProposals = deriveActiveProposals(state.grao.activeProposals, trace);
  if (state.grao.activeProposals.length > 0) state.grao.lastProposalAt = trace.timestamp;
}

function deriveActiveProposals(existing, trace) {
  const intents = new Set(Array.isArray(existing) ? existing : []);
  if (trace.toolCalls.failed > 0) intents.add('stabilize-runtime');
  if (trace.toolCalls.leakedAsText > 0) intents.add('track-tool-reliability');
  return [...intents].slice(-10);
}

function estimateTokens(messages, addition = '') {
  const chars = JSON.stringify(messages || []).length + String(addition || '').length;
  return Math.ceil(chars / 4);
}

function fmt(value) {
  return Number.isFinite(value) ? value.toFixed(2) : 'n/a';
}

function clamp(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

module.exports = {
  RevenantsContextEngine,
  createRevenantsContextEngine,
  buildContextBlock,
  resolveDefaultRootDir: resolveRuntimeRoot,
};
