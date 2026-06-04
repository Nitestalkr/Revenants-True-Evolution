'use strict';

const crypto = require('crypto');

function normalizeMessageTrace({ sessionId, sessionKey, message, source = 'context-engine' }) {
  const role = message?.role || message?.message?.role || 'unknown';
  const content = message?.content || message?.message?.content || '';
  const text = Array.isArray(content)
    ? content.map((part) => typeof part === 'string' ? part : part?.text || '').join('\n')
    : String(content || '');

  return {
    id: makeId(sessionId, sessionKey, role, text),
    timestamp: new Date().toISOString(),
    sessionId,
    sessionKey,
    signalType: role === 'user' ? 'user_interaction' : 'agent',
    source,
    target: sessionKey || sessionId,
    action: `message:${role}`,
    result: 'success',
    impactScore: role === 'user' ? 0.4 : 0.2,
    metadata: {
      role,
      chars: text.length,
    },
  };
}

function normalizeTurnTrace({ sessionId, sessionKey, messages, prePromptMessageCount, runtimeContext }) {
  const newMessages = Array.isArray(messages) ? messages.slice(prePromptMessageCount) : [];
  const toolStats = collectToolStats(newMessages);
  return {
    id: makeId(sessionId, sessionKey, 'turn', JSON.stringify(toolStats), String(Date.now())),
    timestamp: new Date().toISOString(),
    sessionId,
    sessionKey,
    signalType: 'agent',
    source: 'afterTurn',
    target: sessionKey || sessionId,
    action: 'turn_complete',
    result: toolStats.failed > 0 ? 'partial' : 'success',
    impactScore: toolStats.failed > 0 ? 0.7 : 0.3,
    toolCalls: toolStats,
    metadata: {
      newMessageCount: newMessages.length,
      provider: runtimeContext?.provider,
      modelId: runtimeContext?.modelId,
      tokenBudget: runtimeContext?.tokenBudget,
      currentTokenCount: runtimeContext?.currentTokenCount,
    },
  };
}

function normalizeHookTrace({ hookName, event, hookContext, source = 'openclaw-hook' }) {
  const action = String(hookName || 'unknown_hook');
  const ctx = hookContext && typeof hookContext === 'object' ? hookContext : {};
  const toolName = event?.toolName || event?.tool?.name || event?.call?.name || event?.name || ctx.toolName || ctx.tool?.name;
  const status = event?.status || event?.result?.status || event?.outcome || ctx.status || ctx.result?.status;
  const error = event?.error || event?.result?.error || ctx.error || ctx.result?.error;
  const failed = Boolean(error) || /fail|error|timeout|denied/i.test(String(status || ''));
  const result = failed ? 'failure' : status === 'partial' ? 'partial' : 'success';
  const sessionId = event?.sessionId || event?.session?.id || event?.run?.sessionId || ctx.sessionId || ctx.session?.id || ctx.run?.sessionId;
  const sessionKey = event?.sessionKey || event?.session?.key || event?.run?.sessionKey || ctx.sessionKey || ctx.session?.key || ctx.run?.sessionKey;

  return {
    id: makeId(source, action, sessionId, sessionKey, toolName, stableSummary(event), stableSummary(ctx), String(Date.now())),
    timestamp: new Date().toISOString(),
    sessionId,
    sessionKey,
    signalType: signalTypeForHook(action, event, ctx),
    source,
    target: sessionKey || sessionId || 'openclaw-runtime',
    action,
    result,
    impactScore: impactForHook(action, failed, event, ctx),
    metadata: compactHookMetadata(event, ctx, toolName, error),
  };
}

function buildPromotion(trace) {
  const route = routePromotion(trace);
  const promotion = {
    id: makeId('promotion', trace.id),
    timestamp: new Date().toISOString(),
    traceId: trace.id,
    signalType: trace.signalType,
    source: 'revenants',
    target: 'libravdb-review-queue',
    intent: promotionIntent(trace),
    impactScore: trace.impactScore,
    summary: promotionSummary(trace),
    proposalType: route.type,
    mutationTarget: route.target,
    applyMode: route.applyMode,
    validationRequired: route.validationRequired,
    autoApplyEligible: route.autoApplyEligible,
    mutationPlan: {
      rationale: route.rationale,
      summary: route.summary,
    },
    evidence: {
      action: trace.action,
      result: trace.result,
      metadata: trace.metadata,
    },
  };
  if (route.researchAssessment) promotion.researchAssessment = route.researchAssessment;
  return promotion;
}

function collectToolStats(messages) {
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let leakedAsText = 0;

  for (const message of messages) {
    const text = extractText(message);
    if (/\btool[_ ]?call\b/i.test(text) || /<tool_call>/i.test(text)) leakedAsText += 1;
    const calls = message?.toolCalls || message?.tool_calls || [];
    attempted += Array.isArray(calls) ? calls.length : 0;
    if (message?.role === 'tool' || message?.type === 'toolResult') {
      if (message?.isError || /error|failed|permission denied|timeout/i.test(text)) failed += 1;
      else succeeded += 1;
    }
  }

  return { attempted, succeeded, failed, leakedAsText };
}

function extractText(message) {
  const content = message?.content || message?.message?.content || '';
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === 'string' ? part : part?.text || part?.content || '').join('\n');
  }
  return String(content || '');
}

function makeId(...parts) {
  return crypto.createHash('sha1').update(parts.join('\0')).digest('hex').slice(0, 16);
}

function signalTypeForHook(hookName, event, ctx) {
  const alertType = String(event?.type || ctx?.type || '');
  if (/arxiv|paper|research/i.test(alertType)) return 'research';
  if (/tool/i.test(hookName)) return 'tooling';
  if (/session|agent|model/i.test(hookName)) return 'agent';
  if (/message/i.test(hookName)) return 'user_interaction';
  if (/compact|memory|context/i.test(hookName)) return 'memory';
  return 'runtime';
}

function impactForHook(hookName, failed, event, ctx) {
  const alertType = String(event?.type || ctx?.type || '');
  if (/arxiv|paper|research/i.test(alertType)) return 0.82;
  if (failed) return 0.8;
  if (/tool/i.test(hookName)) return 0.5;
  if (/agent_end|session_end|model_call_ended/i.test(hookName)) return 0.4;
  return 0.2;
}

function promotionIntent(trace) {
  if (trace.result === 'failure') return 'stabilize-runtime';
  if (trace.signalType === 'tooling') return 'track-tool-reliability';
  if (trace.signalType === 'memory') return 'track-context-health';
  return 'preserve-adaptive-signal';
}

function promotionSummary(trace) {
  const tool = trace.metadata?.toolName ? ` for ${trace.metadata.toolName}` : '';
  return `${trace.action}${tool} completed with ${trace.result}`;
}

function routePromotion(trace) {
  const signalType = String(trace?.signalType || 'runtime');
  const action = String(trace?.action || '');
  const result = String(trace?.result || '');
  const metadata = trace?.metadata || {};
  const errorText = String(metadata.error || metadata.status || '').toLowerCase();

  if (signalType === 'memory') {
    return {
      type: 'memory',
      target: 'MEMORY.md',
      applyMode: 'memory-update',
      validationRequired: ['human-review'],
      autoApplyEligible: false,
      rationale: 'Context and memory signals are safest to capture as durable memory rather than runtime mutation.',
      summary: 'Update durable memory/context notes with the learned signal.',
    };
  }

  if (signalType === 'research' || /research|arxiv/i.test(action) || /arxiv|paper|research/i.test(String(trace?.source || ''))) {
    return {
      type: 'research',
      target: 'research-review',
      applyMode: 'proposal-only',
      validationRequired: ['human-review', 'source-check'],
      autoApplyEligible: false,
      rationale: 'Research-origin signals should stay reviewable until a human chooses the right downstream mutation target.',
      summary: 'Keep as a research proposal until translated into policy, config, or implementation work.',
      researchAssessment: buildResearchAssessment(trace),
    };
  }

  if (signalType === 'runtime' || /gateway|plugin_start|plugin_stop|monitor/i.test(action)) {
    return {
      type: 'runtime',
      target: 'runtime-config',
      applyMode: 'config-patch',
      validationRequired: ['schema', 'rollback', 'human-review'],
      autoApplyEligible: false,
      rationale: 'Runtime stability signals should route through validated operational config changes.',
      summary: 'Prepare a validated runtime/config patch with rollback safety.',
    };
  }

  if (signalType === 'tooling') {
    if (/blocked|denied|unauthor|private|forbidden|policy/i.test(errorText)) {
      return {
        type: 'policy',
        target: 'AGENTS.md',
        applyMode: 'doc-patch',
        validationRequired: ['human-review'],
        autoApplyEligible: false,
        rationale: 'Policy-shaped tool failures should become operator guidance instead of unsafe low-level mutation.',
        summary: 'Patch AGENTS.md with safer handling and escalation guidance for this failure class.',
      };
    }

    if (result === 'failure' || result === 'partial') {
      return {
        type: 'runtime',
        target: 'runtime-config',
        applyMode: 'config-patch',
        validationRequired: ['schema', 'rollback', 'human-review'],
        autoApplyEligible: false,
        rationale: 'Operational tool failures map best to validated runtime tuning before code mutation.',
        summary: 'Prepare a validated runtime/config change to reduce repeated tool failures.',
      };
    }

    return {
      type: 'tooling',
      target: 'TOOLS.md',
      applyMode: 'doc-patch',
      validationRequired: ['human-review'],
      autoApplyEligible: false,
      rationale: 'Tooling improvements are safest when recorded as operator/tool usage guidance first.',
      summary: 'Patch TOOLS.md with improved tool usage guidance or enhancement notes.',
    };
  }

  if (/persona|style|tone|voice|identity|soul/i.test(action)) {
    return {
      type: 'personality',
      target: 'SOUL.md',
      applyMode: 'doc-patch',
      validationRequired: ['human-review'],
      autoApplyEligible: false,
      rationale: 'Identity and tone changes belong in the persona layer rather than runtime config.',
      summary: 'Patch SOUL.md with the approved personality or tone adjustment.',
    };
  }

  return {
    type: 'implementation',
    target: 'implementation-task',
    applyMode: 'task',
    validationRequired: ['human-review'],
    autoApplyEligible: false,
    rationale: 'Unclassified proposals should default to explicit engineering follow-up instead of silent mutation.',
    summary: 'Convert the approved proposal into an implementation task.',
  };
}

function compactHookMetadata(event, ctx, toolName, error) {
  const paper = event?.paper || ctx?.paper;
  const metadata = {
    toolName,
    modelId: event?.modelId || event?.model || event?.request?.model || ctx?.modelId || ctx?.model || ctx?.request?.model,
    provider: event?.provider || event?.request?.provider || ctx?.provider || ctx?.request?.provider,
    status: event?.status || event?.result?.status || ctx?.status || ctx?.result?.status,
    trigger: event?.trigger || ctx?.trigger,
    channel: event?.channel || event?.sourceChannel || ctx?.channel || ctx?.sourceChannel,
    channelId: event?.channelId || ctx?.channelId,
    accountId: event?.accountId || ctx?.accountId,
    threadId: event?.threadId || event?.messageThreadId || ctx?.threadId || ctx?.messageThreadId,
    messageId: event?.messageId || ctx?.messageId,
    senderId: event?.senderId || ctx?.senderId,
    agentId: event?.agentId || ctx?.agentId,
    durationMs: event?.durationMs || event?.elapsedMs || event?.timing?.durationMs || ctx?.durationMs || ctx?.elapsedMs || ctx?.timing?.durationMs,
    tokenUsage: event?.usage || event?.result?.usage || ctx?.usage || ctx?.result?.usage,
    alertType: event?.type || ctx?.type,
  };
  if (paper) metadata.paper = compactPaperMetadata(paper);
  if (error) metadata.error = safeString(error);
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined));
}

function compactPaperMetadata(paper) {
  return {
    id: paper?.id,
    title: safeString(paper?.title).slice(0, 240),
    published: paper?.published || null,
    authors: Array.isArray(paper?.authors) ? paper.authors.slice(0, 5) : [],
    summary: safeString(paper?.summary || '').slice(0, 600),
  };
}

function buildResearchAssessment(trace) {
  const paper = trace?.metadata?.paper || {};
  const title = String(paper?.title || '').toLowerCase();
  const summary = String(paper?.summary || '').toLowerCase();
  const combined = `${title} ${summary}`;
  const cognitiveScore = scoreKeywordHits(combined, [
    'global workspace',
    'global neuronal workspace',
    'attention schema',
    'predictive coding',
    'free energy',
    'cognitive architecture',
    'working memory',
    'agent',
  ]);
  const implementationScore = scoreKeywordHits(combined, [
    'benchmark',
    'framework',
    'system',
    'pipeline',
    'evaluation',
    'architecture',
    'agentic',
    'tool use',
  ]);
  const novelty = clamp01(0.45 + (cognitiveScore * 0.08) + (implementationScore * 0.05));
  const confidence = clamp01(0.5 + (cognitiveScore * 0.06) + (paper?.published ? 0.08 : 0));
  return {
    sourcePaper: {
      id: paper?.id || null,
      title: paper?.title || null,
      published: paper?.published || null,
      authors: Array.isArray(paper?.authors) ? paper.authors.slice(0, 5) : [],
    },
    confidence: round2(confidence),
    novelty: round2(novelty),
    expectedImpact: pickExpectedImpact(novelty, implementationScore, cognitiveScore),
    suggestedMutationTarget: pickResearchTarget(combined, implementationScore, cognitiveScore),
  };
}

function pickResearchTarget(text, implementationScore, cognitiveScore) {
  if (implementationScore >= 2 || cognitiveScore >= 3) return 'implementation-task';
  if (/policy|safety|governance|alignment|constitutional/.test(text)) return 'AGENTS.md';
  if (/prompt|instruction|reasoning strategy|reflection/.test(text)) return 'AGENTS.md';
  if (/tool use|tools|instrumentation|workflow|orchestration/.test(text)) return 'TOOLS.md';
  if (/persona|personality|style|identity/.test(text)) return 'SOUL.md';
  return 'research-review';
}

function pickExpectedImpact(novelty, implementationScore, cognitiveScore) {
  if (novelty >= 0.8 || implementationScore >= 3) return 'high';
  if (novelty >= 0.6 || cognitiveScore >= 2) return 'medium';
  return 'low';
}

function scoreKeywordHits(text, keywords) {
  let score = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword)) score += 1;
  }
  return score;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function stableSummary(value) {
  if (!value || typeof value !== 'object') return safeString(value);
  return safeString({
    keys: Object.keys(value).sort().slice(0, 20),
    toolName: value.toolName || value.tool?.name || value.call?.name,
    status: value.status || value.result?.status,
    modelId: value.modelId || value.model || value.request?.model,
  });
}

function safeString(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return String(text || '').replace(/(token|secret|password|authorization)=?[^,\s}]+/ig, '$1=[redacted]').slice(0, 500);
}

module.exports = {
  normalizeMessageTrace,
  normalizeTurnTrace,
  normalizeHookTrace,
  buildPromotion,
  collectToolStats,
  routePromotion,
};
