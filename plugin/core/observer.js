'use strict';

const path = require('path');
const DataStore = require('./data-store');
const MonitorSuite = require('../monitors/monitor-suite');
const { normalizeHookTrace, buildPromotion } = require('./trace-normalizer');
const { resolveRuntimeRoot } = require('./storage-paths');
const { createPromotionApplier, classifyRuntimeHandling } = require('./promotion-applier');

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

const AUTO_WORK_TRIGGER_ACTIONS = new Set([
  'session_end',
  'agent_end',
  'after_tool_call',
  'monitor_alert',
]);

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
    this.mutationRoot = resolveMutationRoot(this.rootDir, this.pluginConfig);
    this.store = new DataStore(this.rootDir);
    this.promotionApplier = ctx.promotionApplier || createPromotionApplier({
      store: this.store,
      mutationRoot: this.mutationRoot,
      notifyQueuedPromotion: (promotion, trace) => this.notifyQueuedPromotion(promotion, trace),
      readNotificationSessionKey: (promotionId) => this.store.readState()?.notifications?.sentPromotions?.[promotionId]?.sessionKey || null,
    });
    this.suite = null;
    this.started = false;
    this.startRefCount = 0;
    this.hookNames = Array.isArray(this.pluginConfig.hooks)
      ? this.pluginConfig.hooks
      : DEFAULT_HOOKS;
    this.registeredHooks = new Set();
    this.attachedApis = new WeakSet();
    this.hookApiAvailable = true;
  }

  async start(api) {
    this.startRefCount += 1;
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
        registeredHookCount: this.registeredHooks.size,
      },
    });

    if (this.pluginConfig.startMonitors === true) this.startMonitorSuite();
  }

  async stop() {
    this.startRefCount = Math.max(0, this.startRefCount - 1);
    if (this.startRefCount > 0) return;
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
          registeredHookCount: this.registeredHooks.size,
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
    if (!api || typeof api !== 'object') return;
    if (this.attachedApis.has(api)) return;
    this.attachedApis.add(api);

    if (typeof api?.on !== 'function') {
      this.hookApiAvailable = false;
      this.logger?.warn?.('revenants: OpenClaw hook API is unavailable; observer service will only expose status.');
      return;
    }

    for (const hookName of this.hookNames) {
      api.on(hookName, (event, hookContext) => this.recordHook(hookName, event, hookContext), { priority: -50 });
      this.registeredHooks.add(hookName);
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
      const candidate = buildPromotion(trace);
      if (this.shouldQueuePromotion(candidate)) {
        promotion = candidate;
        this.store.appendPromotion(promotion);
      }
    }

    this.store.updateState((state) => {
      trackSessionRoute(state, trace);
      reconcileRuntimeStateFromTrace(state, trace, {
        started: this.started,
        monitorsRunning: Boolean(this.suite),
      });
      updateAutoWorkEvaluationMarker(state, trace);
      updateCounters(state, trace, Boolean(promotion));
      updateDriveScores(state, trace);
      updateGraoSignals(state, trace, promotion);
      return state;
    });

    if (promotion) {
      void this.notifyQueuedPromotion(promotion, trace);
    }

    const autoWorkPromotion = this.maybeQueueAutoWork(trace, { queuedPromotion: promotion });
    if (autoWorkPromotion) {
      void this.notifyQueuedPromotion(autoWorkPromotion, trace);
    }
  }

  shouldPromote(trace) {
    if (this.pluginConfig.queueMemoryProposals === false) return false;
    if (this.pluginConfig.promoteToMemory === false) return false;
    if (trace.signalType === 'tooling' && trace.result === 'failure') {
      return this.shouldPromoteToolFailure(trace);
    }
    if (trace.result === 'failure' || trace.result === 'partial') return true;
    return Number(trace.impactScore || 0) >= Number(this.pluginConfig.proposalMinImpact ?? this.pluginConfig.promotionMinImpact ?? 0.7);
  }

  shouldPromoteToolFailure(trace) {
    const handling = classifyRuntimeHandling(
      trace?.metadata?.error || trace?.metadata?.status || '',
    );
    const clusterCount = countRecentFailureCluster(this.store, trace, this.pluginConfig);
    const threshold = thresholdForFailureHandling(handling, this.pluginConfig);
    return clusterCount >= threshold;
  }

  shouldQueuePromotion(promotion) {
    const cooldownMs = Number(this.pluginConfig.proposalCooldownMs ?? 10 * 60 * 1000);
    if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) return true;

    const signature = promotionSignature(promotion);
    const recentEntries = [
      ...this.store.readPromotions(),
      ...this.store.readReviewedPromotions(100),
      ...this.store.readAppliedMutations(100),
    ];

    for (const entry of recentEntries) {
      if (promotionSignature(entry) !== signature) continue;
      const timestamp = entry.reviewedAt || entry.appliedAt || entry.timestamp;
      if (!timestamp) continue;
      const ageMs = Date.now() - new Date(timestamp).getTime();
      if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < cooldownMs) return false;
    }

    return true;
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
      registeredHooks: [...this.registeredHooks],
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
      const appliedMutations = decision === 'approve'
        ? result.acknowledged.map((promotion) => this.promotionApplier.apply(promotion, {
          reviewer: opts.reviewer || 'agent',
          note: opts.note,
        }))
        : [];

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
        appliedMutations,
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

  maybeQueueAutoWork(trace, opts = {}) {
    if (!isAutoWorkEnabled(this.pluginConfig)) return null;
    if (!shouldEvaluateAutoWorkTrigger(trace)) return null;

    const state = this.store.readState();
    ensureAutoWorkState(state).lastEvaluationAt = trace.timestamp || new Date().toISOString();
    this.store.writeState(state);

    if (!passesAutoWorkQuiescenceGate(state, this.pluginConfig)) return null;

    const queuedPromotions = this.store.readPromotions();
    if (queuedPromotions.some((entry) => entry?.intent?.startsWith?.('auto-work:'))) return null;

    const recentEntries = [
      ...this.store.readReviewedPromotions(50),
      ...this.store.readAppliedMutations(50),
    ];
    const candidate = selectAutoWorkCandidate({
      store: this.store,
      state,
      trace,
      pluginConfig: this.pluginConfig,
      queuedPromotion: opts.queuedPromotion || null,
      recentEntries,
    });

    if (!candidate) return null;
    if (isAutoWorkCandidateCoolingDown(candidate, recentEntries, this.pluginConfig)) return null;

    const promotion = buildAutoWorkPromotion(candidate, trace);
    if (!this.shouldQueuePromotion(promotion)) return null;

    this.store.appendPromotion(promotion);
    this.store.appendTrace({
      id: `${promotion.id}-trace`,
      timestamp: promotion.timestamp,
      sessionId: trace.sessionId || null,
      sessionKey: trace.sessionKey || null,
      signalType: 'runtime',
      source: 'revenants',
      target: trace.sessionKey || trace.sessionId || 'openclaw-runtime',
      action: 'auto_work_candidate',
      result: 'success',
      impactScore: promotion.impactScore,
      metadata: {
        trigger: trace.action,
        status: candidate.kind,
        toolName: candidate.toolName,
        normalizedFailureClass: candidate.normalizedFailureClass,
        clusterCount: candidate.clusterCount,
        clusterWindowMs: candidate.clusterWindowMs,
        linkedRuntimeProposalId: candidate.linkedRuntimeProposalId,
      },
    });
    this.store.updateState((nextState) => {
      ensureAutoWorkState(nextState).lastProposalAt = promotion.timestamp;
      ensureAutoWorkState(nextState).lastCandidateKey = candidate.key;
      updateCounters(nextState, { action: 'auto_work_candidate' }, true);
      updateGraoSignals(nextState, {
        signalType: 'runtime',
        result: 'success',
        action: 'auto_work_candidate',
      }, promotion);
      return nextState;
    });
    return promotion;
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
    proposalType: promotion.proposalType,
    mutationTarget: promotion.mutationTarget,
    applyMode: promotion.applyMode,
    validationRequired: Array.isArray(promotion.validationRequired) ? promotion.validationRequired : [],
    autoApplyEligible: promotion.autoApplyEligible === true,
    mutationPlan: promotion.mutationPlan ? {
      rationale: promotion.mutationPlan.rationale,
      summary: promotion.mutationPlan.summary,
    } : undefined,
    researchAssessment: promotion.researchAssessment ? {
      sourcePaper: promotion.researchAssessment.sourcePaper,
      confidence: promotion.researchAssessment.confidence,
      novelty: promotion.researchAssessment.novelty,
      expectedImpact: promotion.researchAssessment.expectedImpact,
      suggestedMutationTarget: promotion.researchAssessment.suggestedMutationTarget,
    } : undefined,
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
  const allowed = [
    'toolName',
    'modelId',
    'provider',
    'status',
    'trigger',
    'durationMs',
    'normalizedFailureClass',
    'clusterCount',
    'clusterWindowMs',
    'linkedRuntimeProposalId',
    'sourceProposalId',
  ];
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

function ensureAutoWorkState(state) {
  if (!state.autoWork || typeof state.autoWork !== 'object') {
    state.autoWork = {
      lastUserActivityAt: null,
      lastAgentActivityAt: null,
      lastEvaluationAt: null,
      lastProposalAt: null,
      lastCandidateKey: null,
    };
  }
  state.autoWork.lastUserActivityAt = state.autoWork.lastUserActivityAt || null;
  state.autoWork.lastAgentActivityAt = state.autoWork.lastAgentActivityAt || null;
  state.autoWork.lastEvaluationAt = state.autoWork.lastEvaluationAt || null;
  state.autoWork.lastProposalAt = state.autoWork.lastProposalAt || null;
  state.autoWork.lastCandidateKey = state.autoWork.lastCandidateKey || null;
  return state.autoWork;
}

function updateAutoWorkEvaluationMarker(state, trace) {
  const autoWork = ensureAutoWorkState(state);
  const timestamp = trace.timestamp || new Date().toISOString();
  if (trace.signalType === 'user_interaction') autoWork.lastUserActivityAt = timestamp;
  if (trace.signalType === 'agent' || trace.signalType === 'tooling' || trace.signalType === 'runtime') {
    autoWork.lastAgentActivityAt = timestamp;
  }
  autoWork.lastEvaluationAt = timestamp;
}

function isAutoWorkEnabled(pluginConfig) {
  return pluginConfig?.autoWorkEnabled === true || pluginConfig?.autoWork?.enabled === true;
}

function shouldEvaluateAutoWorkTrigger(trace) {
  if (!trace || trace.signalType === 'user_interaction') return false;
  return AUTO_WORK_TRIGGER_ACTIONS.has(String(trace.action || ''));
}

function passesAutoWorkQuiescenceGate(state, pluginConfig) {
  const autoWork = ensureAutoWorkState(state);
  const minIdleMs = Number(
    pluginConfig?.autoWork?.minIdleMs
      ?? pluginConfig?.autoWorkMinIdleMs
      ?? 20 * 60 * 1000,
  );
  const lastUserAt = autoWork.lastUserActivityAt ? new Date(autoWork.lastUserActivityAt).getTime() : 0;
  if (!lastUserAt) return true;
  return (Date.now() - lastUserAt) >= minIdleMs;
}

function selectAutoWorkCandidate({ store, state, trace, pluginConfig, queuedPromotion }) {
  const queuedPromotions = store.readPromotions();
  const implementationTasks = store.readImplementationTasks(20);
  const failureCluster = describeFailureCluster(trace, store, pluginConfig);
  const linkedRuntimePromotion = failureCluster
    ? findRelatedRuntimePromotion(queuedPromotions, failureCluster)
    : null;

  const candidates = [];
  const translatedFollowUp = [...queuedPromotions].reverse().find((entry) => (
    entry?.parentProposalId
      && entry?.proposalType === 'implementation'
      && entry?.mutationTarget === 'implementation-task'
  ));

  if (translatedFollowUp) {
    candidates.push({
      key: `translated-followup:${translatedFollowUp.id}`,
      kind: 'translated_followup',
      rank: 0.92,
      impactScore: Math.max(0.82, Number(translatedFollowUp.impactScore || 0.82)),
      summary: `Resume the translated follow-up from approved research proposal ${translatedFollowUp.parentProposalId}.`,
      details: translatedFollowUp.summary,
      sourceProposalId: translatedFollowUp.id,
      trigger: trace.action,
    });
  }

  const latestTask = implementationTasks.at(-1);
  if (latestTask) {
    candidates.push({
      key: `implementation-task:${latestTask.proposalId || latestTask.createdAt}`,
      kind: 'implementation_backlog',
      rank: 0.86,
      impactScore: 0.78,
      summary: `Resume previous implementation work from ${latestTask.proposalId || 'the latest approved task backlog'}.`,
      details: latestTask.summary,
      sourceProposalId: latestTask.proposalId || null,
      trigger: trace.action,
    });
  }

  if (
    failureCluster
    && failureCluster.clusterCount >= failureCluster.threshold
    && !(queuedPromotion && queuedPromotion.proposalType === 'runtime')
    && !linkedRuntimePromotion
  ) {
    candidates.push({
      key: `failure-cluster:${failureCluster.toolName || 'unknown'}:${failureCluster.normalizedFailureClass}:${failureCluster.clusterCount}`,
      kind: 'failure_cluster',
      rank: 0.74,
      impactScore: 0.76,
      summary: `Investigate repeated ${failureCluster.toolName || 'tool'} failures (${failureCluster.clusterCount} ${failureCluster.normalizedFailureClass} events in ${Math.round(failureCluster.clusterWindowMs / 60000)}m) before they compound further.`,
      details: 'Repeated failures remain a pressure source in the observer state and should be turned into a bounded follow-up task.',
      sourceProposalId: null,
      trigger: trace.action,
      toolName: failureCluster.toolName,
      normalizedFailureClass: failureCluster.normalizedFailureClass,
      clusterCount: failureCluster.clusterCount,
      clusterWindowMs: failureCluster.clusterWindowMs,
      clusterThreshold: failureCluster.threshold,
      linkedRuntimeProposalId: queuedPromotion?.id || linkedRuntimePromotion?.id || null,
    });
  }

  return candidates.sort((a, b) => b.rank - a.rank || b.impactScore - a.impactScore)[0] || null;
}

function isAutoWorkCandidateCoolingDown(candidate, recentEntries, pluginConfig) {
  const cooldownMs = Number(
    pluginConfig?.autoWork?.cooldownMs
      ?? pluginConfig?.autoWorkCooldownMs
      ?? 60 * 60 * 1000,
  );
  for (const entry of recentEntries || []) {
    if (!entry?.intent || !String(entry.intent).startsWith('auto-work:')) continue;
    if (String(entry.intent) !== `auto-work:${candidate.key}`) continue;
    const timestamp = entry.reviewedAt || entry.appliedAt || entry.timestamp;
    if (!timestamp) continue;
    const ageMs = Date.now() - new Date(timestamp).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < cooldownMs) return true;
  }
  return false;
}

function buildAutoWorkPromotion(candidate, trace) {
  return {
    id: `autowork-${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    traceId: trace.id,
    signalType: 'runtime',
    source: 'revenants',
    target: 'libravdb-review-queue',
    intent: `auto-work:${candidate.key}`,
    impactScore: candidate.impactScore,
    summary: candidate.summary,
    proposalType: 'implementation',
    mutationTarget: 'implementation-task',
    applyMode: 'task',
    validationRequired: ['human-review', 'bounded-scope'],
    autoApplyEligible: false,
    mutationPlan: {
      rationale: 'Observer-detected pressure should become a bounded follow-up task proposal before any self-initiated execution is allowed.',
      summary: 'Queue a bounded implementation follow-up task for separate execution review.',
    },
    evidence: {
      action: 'auto_work_evaluation',
      result: 'success',
      metadata: {
        status: candidate.kind,
        trigger: candidate.trigger,
        sourceProposalId: candidate.sourceProposalId,
        toolName: candidate.toolName,
        normalizedFailureClass: candidate.normalizedFailureClass,
        clusterCount: candidate.clusterCount,
        clusterWindowMs: candidate.clusterWindowMs,
        linkedRuntimeProposalId: candidate.linkedRuntimeProposalId,
      },
    },
    autoWorkCandidate: {
      kind: candidate.kind,
      key: candidate.key,
      details: candidate.details,
      toolName: candidate.toolName,
      normalizedFailureClass: candidate.normalizedFailureClass,
      clusterCount: candidate.clusterCount,
      clusterWindowMs: candidate.clusterWindowMs,
      linkedRuntimeProposalId: candidate.linkedRuntimeProposalId,
    },
  };
}

function describeFailureCluster(trace, store, pluginConfig) {
  if (trace?.signalType !== 'tooling' || trace?.result !== 'failure') return null;
  const toolName = String(trace?.metadata?.toolName || '');
  if (!toolName) return null;
  const normalizedFailureClass = classifyRuntimeHandling(
    trace?.metadata?.error || trace?.metadata?.status || '',
  );
  return {
    toolName,
    normalizedFailureClass,
    clusterCount: countRecentFailureCluster(store, trace, pluginConfig),
    clusterWindowMs: resolveFailureClusterWindowMs(pluginConfig),
    threshold: thresholdForFailureHandling(normalizedFailureClass, pluginConfig),
  };
}

function findRelatedRuntimePromotion(promotions, failureCluster) {
  for (const entry of promotions || []) {
    if (entry?.proposalType !== 'runtime') continue;
    const toolName = String(entry?.evidence?.metadata?.toolName || '');
    if (toolName !== String(failureCluster?.toolName || '')) continue;
    const normalizedFailureClass = classifyRuntimeHandling(
      entry?.evidence?.metadata?.error || entry?.evidence?.metadata?.status || '',
    );
    if (normalizedFailureClass !== failureCluster?.normalizedFailureClass) continue;
    return entry;
  }
  return null;
}

function countRecentFailureCluster(store, trace, pluginConfig) {
  const traces = store.tailTraces(200);
  const windowMs = resolveFailureClusterWindowMs(pluginConfig);
  const handling = classifyRuntimeHandling(
    trace?.metadata?.error || trace?.metadata?.status || '',
  );
  const toolName = String(trace?.metadata?.toolName || '');
  const currentTime = new Date(trace?.timestamp || Date.now()).getTime();

  let count = 0;
  for (const entry of traces) {
    if (entry?.signalType !== 'tooling' || entry?.result !== 'failure') continue;
    if (String(entry?.metadata?.toolName || '') !== toolName) continue;
    const entryHandling = classifyRuntimeHandling(
      entry?.metadata?.error || entry?.metadata?.status || '',
    );
    if (entryHandling !== handling) continue;
    const timestamp = new Date(entry?.timestamp || 0).getTime();
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    if ((currentTime - timestamp) <= windowMs) count += 1;
  }
  return count;
}

function resolveFailureClusterWindowMs(pluginConfig) {
  return Number(
    pluginConfig?.failureClusterWindowMs
      ?? pluginConfig?.autoWork?.failureClusterWindowMs
      ?? 30 * 60 * 1000,
  );
}

function thresholdForFailureHandling(handling, pluginConfig) {
  const configured = pluginConfig?.failureClusterThresholds || {};
  if (handling === 'avoid-repeat-and-escalate') {
    return Number(configured.policy ?? 1);
  }
  if (handling === 'increase-timeout-and-retry-carefully') {
    return Number(configured.timeout ?? 2);
  }
  return Number(configured.default ?? 3);
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
  if (promotion.proposalType) lines.push(`Type: ${promotion.proposalType} -> ${promotion.mutationTarget || 'unrouted'}`);
  lines.push(`Risk: ${impactToRiskLabel(promotion.impactScore)} (${Number(promotion.impactScore || 0).toFixed(2)})`);
  lines.push(`Why: ${promotion.summary}`);
  if (promotion.mutationPlan?.summary) lines.push(`Apply path: ${promotion.mutationPlan.summary}`);
  if (promotion.researchAssessment?.sourcePaper?.title) lines.push(`Source paper: ${promotion.researchAssessment.sourcePaper.title}`);
  if (promotion.researchAssessment) {
    lines.push(`Research confidence: ${Number(promotion.researchAssessment.confidence || 0).toFixed(2)}`);
    lines.push(`Research novelty: ${Number(promotion.researchAssessment.novelty || 0).toFixed(2)}`);
    lines.push(`Expected impact: ${promotion.researchAssessment.expectedImpact}`);
    lines.push(`Suggested target: ${promotion.researchAssessment.suggestedMutationTarget}`);
  }
  if (trace?.metadata?.toolName) lines.push(`Tool: ${trace.metadata.toolName}`);
  const clusterCount = Number(promotion?.evidence?.metadata?.clusterCount || 0);
  if (clusterCount > 0) {
    const clusterTool = promotion?.evidence?.metadata?.toolName || trace?.metadata?.toolName || 'unknown-tool';
    const clusterClass = promotion?.evidence?.metadata?.normalizedFailureClass || 'unknown-failure-class';
    const clusterWindowMs = Number(promotion?.evidence?.metadata?.clusterWindowMs || 0);
    const clusterWindowMinutes = clusterWindowMs > 0 ? Math.round(clusterWindowMs / 60000) : null;
    lines.push(`Cluster: ${clusterTool} / ${clusterClass} / ${clusterCount} events${clusterWindowMinutes ? ` in ${clusterWindowMinutes}m` : ''}`);
    if (promotion?.evidence?.metadata?.linkedRuntimeProposalId) {
      lines.push(`Linked runtime proposal: ${promotion.evidence.metadata.linkedRuntimeProposalId}`);
    }
  }
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

function resolveMutationRoot(rootDir, pluginConfig) {
  const configured = pluginConfig?.mutationRoot || pluginConfig?.workspaceRoot;
  if (typeof configured === 'string' && configured.trim()) return configured;
  return path.resolve(__dirname, '..', '..');
}

function promotionSignature(entry) {
  const toolName = entry?.evidence?.metadata?.toolName || entry?.toolName || '';
  const errorText = String(
    entry?.evidence?.metadata?.error
      || entry?.evidence?.metadata?.status
      || entry?.details
      || '',
  ).toLowerCase();
  const normalizedError = classifyRuntimeHandling(errorText);
  const sourcePaper = entry?.researchAssessment?.sourcePaper?.title
    || entry?.evidence?.metadata?.sourcePaperTitle
    || '';
  return [
    entry?.proposalType || '',
    entry?.mutationTarget || '',
    entry?.intent || '',
    entry?.applyMode || '',
    entry?.evidence?.action || '',
    toolName,
    normalizedError,
    sourcePaper,
  ].join('::');
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
