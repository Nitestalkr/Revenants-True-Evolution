'use strict';

const DataStore = require('./data-store');
const MonitorSuite = require('../monitors/monitor-suite');
const { normalizeHookTrace, buildPromotion } = require('./trace-normalizer');
const { resolveRuntimeRoot } = require('./storage-paths');

const DEFAULT_HOOKS = [
  'gateway_start',
  'gateway_stop',
  'session_start',
  'session_end',
  'before_dispatch',
  'before_prompt_build',
  'message_received',
  'message_sending',
  'message_sent',
  'before_tool_call',
  'after_tool_call',
  'model_call_started',
  'model_call_ended',
  'before_compaction',
  'after_compaction',
  'before_reset',
  'before_agent_finalize',
  'agent_end',
];

function createRevenantsObserver(ctx = {}) {
  return new RevenantsObserver(ctx);
}

class RevenantsObserver {
  constructor(ctx = {}) {
    this.api = null;
    this.logger = ctx.logger || console;
    this.pluginConfig = ctx.pluginConfig || {};
    this.rootDir = resolveRuntimeRoot({ ...this.pluginConfig, dataDir: ctx.rootDir || this.pluginConfig.dataDir });
    this.store = new DataStore(this.rootDir);
    this.suite = null;
    this.started = false;
    this.hookNames = Array.isArray(this.pluginConfig.hooks)
      ? this.pluginConfig.hooks
      : DEFAULT_HOOKS;
    this.registeredHooks = [];
    this.hooksAttached = false;
    this.hookApiAvailable = true;
  }

  async start(api) {
    if (this.started) return;
    this.api = api;
    this.store.ensure();
    this.started = true;

    this.recordTrace({
      id: `revenants-start-${Date.now()}`,
      timestamp: new Date().toISOString(),
      signalType: 'runtime',
      source: 'revenants',
      target: 'openclaw-runtime',
      action: 'plugin_start',
      result: 'success',
      impactScore: 0.3,
      metadata: {
        mode: this.pluginConfig.registerContextEngine === true ? 'context-engine-plus-observer' : 'companion-observer',
        hookApiAvailable: this.hookApiAvailable,
        registeredHookCount: this.registeredHooks.length,
      },
    });

    if (this.pluginConfig.startMonitors === true) this.startMonitorSuite();
  }

  async stop() {
    if (this.suite) {
      this.suite.stop();
      this.suite = null;
    }
    this.started = false;
  }

  registerHooks(api) {
    if (this.hooksAttached) return;
    this.hooksAttached = true;

    if (typeof api?.on !== 'function') {
      this.hookApiAvailable = false;
      this.logger?.warn?.('revenants: OpenClaw hook API is unavailable; observer service will only expose status.');
      return;
    }

    for (const hookName of this.hookNames) {
      api.on(hookName, (event, hookContext) => this.recordHook(hookName, event, hookContext), { priority: -50 });
      this.registeredHooks.push(hookName);
    }
  }

  startMonitorSuite() {
    if (this.suite) return;
    this.suite = new MonitorSuite({
      ...(this.pluginConfig.monitors || {}),
      dataDir: this.rootDir,
    });
    this.suite.on('alert', (alert) => this.recordHook('monitor_alert', alert));
    this.suite.start();
  }

  recordHook(hookName, event = {}, hookContext = {}) {
    if (!this.started && this.pluginConfig.recordBeforeStart !== true) return null;
    const trace = normalizeHookTrace({ hookName, event, hookContext });
    this.recordTrace(trace);
    return trace;
  }

  recordTrace(trace) {
    this.store.appendTrace(trace);
    let queuedPromotion = false;

    if (this.shouldPromote(trace)) {
      this.store.appendPromotion(buildPromotion(trace));
      queuedPromotion = true;
    }

    this.store.updateState((state) => {
      updateCounters(state, trace, queuedPromotion);
      updateDriveScores(state, trace);
      updateGraoSignals(state, trace);
      return state;
    });
  }

  shouldPromote(trace) {
    if (this.pluginConfig.queueMemoryProposals === false) return false;
    if (this.pluginConfig.promoteToMemory === false) return false;
    if (trace.result === 'failure' || trace.result === 'partial') return true;
    return Number(trace.impactScore || 0) >= Number(this.pluginConfig.proposalMinImpact ?? this.pluginConfig.promotionMinImpact ?? 0.7);
  }

  getStatus(limit = 10, opts = {}) {
    const raw = opts.includeRaw === true && this.pluginConfig.allowRawStatus === true;
    const status = {
      mode: this.pluginConfig.registerContextEngine === true ? 'context-engine-plus-observer' : 'companion-observer',
      started: this.started,
      monitorsRunning: Boolean(this.suite),
      registeredHooks: this.registeredHooks,
      state: this.store.readState(),
      recentTraces: this.store.tailTraces(limit),
      queuedPromotions: this.store.tailPromotions(limit),
    };
    return raw ? status : redactStatus(status);
  }
}

function redactStatus(status) {
  return {
    ...status,
    recentTraces: status.recentTraces.map(redactTrace),
    queuedPromotions: status.queuedPromotions.map(redactPromotion),
  };
}

function redactTrace(trace) {
  return {
    id: trace.id,
    timestamp: trace.timestamp,
    signalType: trace.signalType,
    source: trace.source,
    target: trace.target === 'openclaw-runtime' ? trace.target : '[session]',
    action: trace.action,
    result: trace.result,
    impactScore: trace.impactScore,
    metadata: redactMetadata(trace.metadata || {}),
  };
}

function redactPromotion(promotion) {
  return {
    id: promotion.id,
    timestamp: promotion.timestamp,
    signalType: promotion.signalType,
    source: promotion.source,
    target: 'libravdb-review-queue',
    intent: promotion.intent,
    impactScore: promotion.impactScore,
    summary: promotion.summary,
    evidence: promotion.evidence ? {
      action: promotion.evidence.action,
      result: promotion.evidence.result,
      metadata: redactMetadata(promotion.evidence.metadata || {}),
    } : undefined,
  };
}

function redactMetadata(metadata) {
  const allowed = ['toolName', 'modelId', 'provider', 'status', 'trigger', 'durationMs'];
  return Object.fromEntries(allowed
    .filter((key) => metadata[key] !== undefined)
    .map((key) => [key, metadata[key]]));
}

function updateCounters(state, trace, queuedPromotion) {
  state.cycleCount += trace.action === 'agent_end' ? 1 : 0;
  if (/message/i.test(trace.action)) state.counters.messagesIngested += 1;
  if (/tool/i.test(trace.action)) state.counters.toolCallsObserved += 1;
  if (/tool/i.test(trace.action) && trace.result === 'failure') state.counters.toolFailuresObserved += 1;
  if (trace.action === 'agent_end') state.counters.turnsObserved += 1;
  if (queuedPromotion) state.counters.promotionsQueued += 1;
}

function updateDriveScores(state, trace) {
  const scores = state.driveScores;
  if (trace.result === 'failure' || trace.result === 'partial') {
    scores.competence = clamp(scores.competence + 0.06);
    scores.safety = clamp(scores.safety + 0.05);
  }
  if (trace.signalType === 'user_interaction') scores.helpfulness = clamp(scores.helpfulness + 0.03);
  if (trace.signalType === 'tooling') scores.goal_directed = clamp(scores.goal_directed + 0.02);
}

function updateGraoSignals(state, trace) {
  const gradients = new Set(state.grao.activeGradients || []);
  if (trace.result === 'failure' && trace.signalType === 'tooling') gradients.add('tool-call-reliability');
  if (trace.signalType === 'memory') gradients.add('context-integrity');
  if (trace.signalType === 'runtime') gradients.add('runtime-stability');
  state.grao.activeGradients = [...gradients].slice(-10);
}

function clamp(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

module.exports = {
  RevenantsObserver,
  createRevenantsObserver,
  DEFAULT_HOOKS,
  resolveDefaultRootDir: resolveRuntimeRoot,
};
