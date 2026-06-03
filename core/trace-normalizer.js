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
    signalType: signalTypeForHook(action),
    source,
    target: sessionKey || sessionId || 'openclaw-runtime',
    action,
    result,
    impactScore: impactForHook(action, failed),
    metadata: compactHookMetadata(event, ctx, toolName, error),
  };
}

function buildPromotion(trace) {
  return {
    id: makeId('promotion', trace.id),
    timestamp: new Date().toISOString(),
    traceId: trace.id,
    signalType: trace.signalType,
    source: 'revenants',
    target: 'libravdb-review-queue',
    intent: promotionIntent(trace),
    impactScore: trace.impactScore,
    summary: promotionSummary(trace),
    evidence: {
      action: trace.action,
      result: trace.result,
      metadata: trace.metadata,
    },
  };
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

function signalTypeForHook(hookName) {
  if (/tool/i.test(hookName)) return 'tooling';
  if (/session|agent|model/i.test(hookName)) return 'agent';
  if (/message/i.test(hookName)) return 'user_interaction';
  if (/compact|memory|context/i.test(hookName)) return 'memory';
  return 'runtime';
}

function impactForHook(hookName, failed) {
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

function compactHookMetadata(event, ctx, toolName, error) {
  const metadata = {
    toolName,
    modelId: event?.modelId || event?.model || event?.request?.model || ctx?.modelId || ctx?.model || ctx?.request?.model,
    provider: event?.provider || event?.request?.provider || ctx?.provider || ctx?.request?.provider,
    status: event?.status || event?.result?.status || ctx?.status || ctx?.result?.status,
    trigger: event?.trigger || ctx?.trigger,
    channelId: event?.channelId || ctx?.channelId,
    agentId: event?.agentId || ctx?.agentId,
    durationMs: event?.durationMs || event?.elapsedMs || event?.timing?.durationMs || ctx?.durationMs || ctx?.elapsedMs || ctx?.timing?.durationMs,
    tokenUsage: event?.usage || event?.result?.usage || ctx?.usage || ctx?.result?.usage,
  };
  if (error) metadata.error = safeString(error);
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined));
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
};
