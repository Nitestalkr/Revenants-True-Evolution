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
    this.proposalNotifier = typeof ctx.proposalNotifier === 'function' ? ctx.proposalNotifier : null;
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
    if (this.started) {
      this.recordTrace({
        id: `revenants-stop-${Date.now()}`,
        timestamp: new Date().toISOString(),
        signalType: 'runtime',
        source: 'revenants',
        target: 'openclaw-runtime',
        action: 'plugin_stop',
        result: 'success',
        impactScore: 0.1,
        metadata: {
          registeredHookCount: this.registeredHooks.length,
        },
      });
    }
    if (this.suite) {
      this.suite.stop();
      this.suite = null;
    }
    this.started = false;
    this.store.updateState((state) => {
      const runtime = ensureRuntimeState(state);
      runtime.monitorsRunning = false;
      return state;
    });
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
    this.store.updateState((state) => {
      const runtime = ensureRuntimeState(state);
      runtime.monitorsRunning = true;
      return state;
    });
  }

  recordHook(hookName, event = {}, hookContext = {}) {
    if (!this.started && this.pluginConfig.recordBeforeStart !== true) return null;
    const trace = normalizeHookTrace({ hookName, event, hookContext });
    this.recordTrace(trace);
    return trace;
  }

  recordTrace(trace) {
    this.store.appendTrace(trace);
    let promotion = null;

    if (this.shouldPromote(trace)) {
      promotion = buildPromotion(trace);
      this.store.appendPromotion(promotion);
    }

    this.store.updateState((state) => {
      trackSessionRoute(state, trace);
      reconcileRuntimeStateFromTrace(state, trace, {
        started: this.started,
        monitorsRunning: Boolean(this.suite),
      });
      updateCounters(state, trace, Boolean(promotion));
      updateDriveScores(state, trace);
      updateGraoSignals(state, trace, promotion);
      return state;
    });

    if (promotion) {
      void this.notifyQueuedPromotion(promotion, trace);
    }
  }

  shouldPromote(trace) {
    if (this.pluginConfig.queueMemoryProposals === false) return false;
    if (this.pluginConfig.promoteToMemory === false) return false;
    if (trace.result === 'failure' || trace.result === 'partial') return true;
    return Number(trace.impactScore || 0) >= Number(this.pluginConfig.proposalMinImpact ?? this.pluginConfig.promotionMinImpact ?? 0.7);
  }

  getStatus(limit = 10, opts = {}) {
    const raw = opts.includeRaw === true && this.pluginConfig.allowRawStatus === true;
    const state = this.store.readState();
    const recentTraces = this.store.tailTraces(limit);
    const runtime = deriveRuntimeStatus({
      state,
      recentTraces,
      started: this.started,
      monitorsRunning: Boolean(this.suite),
    });
    const status = {
      mode: this.pluginConfig.registerContextEngine === true ? 'context-engine-plus-observer' : 'companion-observer',
      started: runtime.started,
      monitorsRunning: runtime.monitorsRunning,
      registeredHooks: this.registeredHooks,
      state,
      recentTraces,
      queuedPromotions: this.store.tailPromotions(limit),
    };
    return raw ? status : redactStatus(status);
  }

  reviewQueue(action = 'peek', opts = {}) {
    const limit = Math.max(1, Math.min(Number(opts.limit) || 10, 50));

    if (action === 'ack' || action === 'approve' || action === 'reject' || action === 'defer') {
      const decision = action === 'ack' ? 'approve' : action;
      const retain = decision === 'defer';
      const result = this.store.reviewPromotions(opts.ids || [], {
        reviewer: opts.reviewer || 'agent',
        note: opts.note,
        decision,
      }, { retain });

      this.store.updateState((state) => {
        const remainingPromotions = this.store.readPromotions();
        state.grao.activeProposals = refreshActiveProposals(remainingPromotions);
        state.grao.lastProposalAt = remainingPromotions.at(-1)?.timestamp || null;
        rememberPromotionNotifications(state, result.acknowledged, {
          decision,
          reviewer: opts.reviewer || 'agent',
        });
        return state;
      });

      return {
        action: decision,
        acknowledgedCount: result.acknowledged.length,
        acknowledgedIds: result.acknowledged.map((promotion) => promotion.id),
        remainingCount: result.remaining,
        recentReviewed: result.acknowledged.slice(-limit).map(redactPromotion),
      };
    }

    const promotions = this.store.readPromotions();
    const recent = promotions.slice(-limit);
    const intents = summarizePromotionIntents(promotions);

    return {
      action: action === 'stats' ? 'stats' : 'peek',
      queuedCount: promotions.length,
      intents,
      recent: recent.map(redactPromotion),
      recentlyReviewed: this.store.readReviewedPromotions(limit).map(redactPromotion),
    };
  }

  async notifyQueuedPromotion(promotion, trace) {
    if (this.pluginConfig.notifySessionOnProposal === false) return;
    if (!this.proposalNotifier) return;

    const state = this.store.readState();
    if (state?.notifications?.sentPromotions?.[promotion.id]) return;

    const route = resolveNotificationRoute(state, trace);
    if (!route) return;

    try {
      await this.proposalNotifier({
        promotion,
        trace,
        route,
        message: formatProposalNotification(promotion, trace, route),
      });

      this.store.updateState((nextState) => {
        ensureNotificationState(nextState).sentPromotions[promotion.id] = {
          sentAt: new Date().toISOString(),
          sessionKey: route.sessionKey || trace.sessionKey || null,
          target: route.target || null,
          decision: 'pending',
        };
        return nextState;
      });
    } catch (error) {
      this.logger?.warn?.(`revenants: proposal notification failed: ${error?.message || error}`);
    }
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

function trackSessionRoute(state, trace) {
  const route = routeFromTrace(trace);
  if (!route?.sessionKey) return;
  const routes = ensureSessionRoutes(state);
  routes[route.sessionKey] = mergeDefined(routes[route.sessionKey] || {}, {
    ...route,
    lastSeenAt: trace.timestamp || new Date().toISOString(),
  });
  trimMap(routes, 100);
}

function updateCounters(state, trace, queuedPromotion) {
  state.cycleCount += trace.action === 'agent_end' ? 1 : 0;
  if (/message/i.test(trace.action)) state.counters.messagesIngested += 1;
  if (/tool/i.test(trace.action)) state.counters.toolCallsObserved += 1;
  if (/tool/i.test(trace.action) && trace.result === 'failure') state.counters.toolFailuresObserved += 1;
  if (trace.action === 'agent_end') state.counters.turnsObserved += 1;
  if (queuedPromotion) state.counters.promotionsQueued += 1;
}

function reconcileRuntimeStateFromTrace(state, trace, volatile) {
  const runtime = ensureRuntimeState(state);
  runtime.lastTraceAt = trace.timestamp || new Date().toISOString();

  if (trace.action === 'plugin_start' && trace.result === 'success') {
    runtime.observerStartedAt = trace.timestamp || new Date().toISOString();
    runtime.observerStoppedAt = null;
    runtime.serviceStartCount += 1;
  }

  if (trace.action === 'plugin_stop' && trace.result === 'success') {
    runtime.observerStoppedAt = trace.timestamp || new Date().toISOString();
  }

  runtime.monitorsRunning = Boolean(volatile?.monitorsRunning);
}

function deriveRuntimeStatus({ state, recentTraces, started, monitorsRunning }) {
  const runtime = ensureRuntimeState(state);
  const lastTraceAt = parseTimestamp(runtime.lastTraceAt)
    || parseTimestamp(findLatestTraceTimestamp(recentTraces));
  const observerStartedAt = parseTimestamp(runtime.observerStartedAt)
    || parseTimestamp(findLatestTraceTimestamp(recentTraces, 'plugin_start'));
  const observerStoppedAt = parseTimestamp(runtime.observerStoppedAt)
    || parseTimestamp(findLatestTraceTimestamp(recentTraces, 'plugin_stop'));

  const observedActive = Boolean(
    lastTraceAt
      && observerStartedAt
      && lastTraceAt >= observerStartedAt
      && (!observerStoppedAt || lastTraceAt > observerStoppedAt),
  );

  return {
    started: Boolean(started || observedActive),
    monitorsRunning: Boolean(monitorsRunning || runtime.monitorsRunning),
  };
}

function findLatestTraceTimestamp(traces, action) {
  let latest = null;
  for (const trace of traces || []) {
    if (action && trace?.action !== action) continue;
    const candidate = parseTimestamp(trace?.timestamp);
    if (!candidate) continue;
    if (!latest || candidate > latest) latest = candidate;
  }
  return latest ? latest.toISOString() : null;
}

function parseTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function ensureRuntimeState(state) {
  if (!state.runtime || typeof state.runtime !== 'object') {
    state.runtime = {
      observerStartedAt: null,
      observerStoppedAt: null,
      lastTraceAt: null,
      monitorsRunning: false,
      serviceStartCount: 0,
    };
  }
  state.runtime.observerStartedAt = state.runtime.observerStartedAt || null;
  state.runtime.observerStoppedAt = state.runtime.observerStoppedAt || null;
  state.runtime.lastTraceAt = state.runtime.lastTraceAt || null;
  state.runtime.monitorsRunning = state.runtime.monitorsRunning === true;
  state.runtime.serviceStartCount = Number(state.runtime.serviceStartCount) || 0;
  return state.runtime;
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

function updateGraoSignals(state, trace, promotion) {
  const gradients = new Set(state.grao.activeGradients || []);
  if (trace.result === 'failure' && trace.signalType === 'tooling') gradients.add('tool-call-reliability');
  if (trace.signalType === 'memory') gradients.add('context-integrity');
  if (trace.signalType === 'runtime') gradients.add('runtime-stability');
  state.grao.activeGradients = [...gradients].slice(-10);
  if (trace.result === 'failure') state.grao.knownFailureCount += 1;
  if (promotion) {
    state.grao.activeProposals = refreshActiveProposals([
      ...(Array.isArray(state.grao.activeProposals) ? state.grao.activeProposals : []).map((intent) => ({ intent })),
      promotion,
    ]);
    state.grao.lastProposalAt = promotion.timestamp;
  }
}

function refreshActiveProposals(promotions) {
  const intents = [];
  const seen = new Set();
  for (const promotion of (promotions || []).slice().reverse()) {
    const intent = promotion?.intent;
    if (!intent || seen.has(intent)) continue;
    seen.add(intent);
    intents.push(intent);
    if (intents.length >= 10) break;
  }
  return intents.reverse();
}

function summarizePromotionIntents(promotions) {
  const counts = new Map();
  for (const promotion of promotions || []) {
    const intent = promotion?.intent || 'unknown';
    counts.set(intent, (counts.get(intent) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([intent, count]) => ({ intent, count }));
}

function resolveNotificationRoute(state, trace) {
  const current = routeFromTrace(trace);
  const sessionKey = trace?.sessionKey;
  const remembered = sessionKey ? ensureSessionRoutes(state)[sessionKey] : null;
  const merged = mergeDefined(remembered || {}, current || {});
  return merged?.target ? merged : null;
}

function routeFromTrace(trace) {
  const sessionKey = trace?.sessionKey;
  const metadata = trace?.metadata || {};
  const parsed = parseSessionRoute(sessionKey);
  if (!parsed) return null;
  return {
    sessionKey,
    channel: metadata.channel || parsed.channel,
    target: parsed.target,
    accountId: metadata.accountId,
    threadId: metadata.threadId,
    replyToId: metadata.messageId,
    senderId: metadata.senderId,
  };
}

function parseSessionRoute(sessionKey) {
  if (typeof sessionKey !== 'string' || !sessionKey) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 5 || parts[0] !== 'agent') return null;
  const channel = parts[2];
  const scope = parts[3];
  const id = parts.slice(4).join(':');
  if (!channel || !id) return null;
  if (scope === 'channel') return { channel, target: `channel:${id}` };
  if (scope === 'user' || scope === 'dm') return { channel, target: `user:${id}` };
  return null;
}

function formatProposalNotification(promotion, trace, route) {
  const lines = [];
  if (route.senderId && route.channel === 'discord') lines.push(`<@${route.senderId}>`);
  lines.push(`Revenants proposal queued: \`${promotion.id}\``);
  lines.push(`Intent: ${promotion.intent}`);
  lines.push(`Risk: ${impactToRiskLabel(promotion.impactScore)} (${Number(promotion.impactScore || 0).toFixed(2)})`);
  lines.push(`Why: ${promotion.summary}`);
  if (trace?.metadata?.toolName) lines.push(`Tool: ${trace.metadata.toolName}`);
  lines.push('Review in chat with:');
  lines.push(`- \`revenants approve ${promotion.id}\``);
  lines.push(`- \`revenants reject ${promotion.id}\``);
  lines.push('- `revenants queue`');
  return lines.join('\n');
}

function impactToRiskLabel(score) {
  const value = Number(score || 0);
  if (value >= 0.8) return 'high';
  if (value >= 0.5) return 'medium';
  return 'low';
}

function ensureSessionRoutes(state) {
  if (!state.sessionRoutes || typeof state.sessionRoutes !== 'object') state.sessionRoutes = {};
  return state.sessionRoutes;
}

function ensureNotificationState(state) {
  if (!state.notifications || typeof state.notifications !== 'object') {
    state.notifications = { sentPromotions: {} };
  }
  if (!state.notifications.sentPromotions || typeof state.notifications.sentPromotions !== 'object') {
    state.notifications.sentPromotions = {};
  }
  return state.notifications;
}

function rememberPromotionNotifications(state, promotions, meta) {
  const sent = ensureNotificationState(state).sentPromotions;
  for (const promotion of promotions || []) {
    sent[promotion.id] = {
      ...(sent[promotion.id] || {}),
      decidedAt: new Date().toISOString(),
      decision: meta?.decision || 'reviewed',
      reviewer: meta?.reviewer || null,
    };
  }
  trimMap(sent, 200);
}

function trimMap(map, maxEntries) {
  const keys = Object.keys(map || {});
  if (keys.length <= maxEntries) return;
  for (const key of keys.slice(0, keys.length - maxEntries)) {
    delete map[key];
  }
}

function mergeDefined(base, patch) {
  const next = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value !== undefined) next[key] = value;
  }
  return next;
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
