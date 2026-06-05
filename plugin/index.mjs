import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const { createRevenantsContextEngine } = require('./core/context-engine.js');
const { createRevenantsObserver } = require('./core/observer.js');
const execFileAsync = promisify(execFile);
const OBSERVER_SINGLETONS = globalThis.__revenantsObserverSingletons || (globalThis.__revenantsObserverSingletons = new Map());
const CHAT_BRIDGE_APIS = globalThis.__revenantsChatBridgeApis || (globalThis.__revenantsChatBridgeApis = new WeakSet());

export default {
  id: 'revenants',
  name: 'Revenants',
  description: 'Companion evolution layer for GNW/GRAO tracing, monitoring, and LibraVDB promotion signals.',
  register(api, runtimeConfig) {
    const pluginConfig = resolvePluginConfig(api, runtimeConfig);
    if (pluginConfig.enabled === false) {
      api.logger?.info?.('revenants: plugin disabled by config.');
      return;
    }

    const rootDir = resolvePluginRootDir(api, pluginConfig);
    const observer = getSharedObserver({
      pluginConfig,
      rootDir,
      logger: api.logger,
      proposalNotifier: createProposalNotifier(api, pluginConfig),
    });

    observer.registerHooks(api);
    registerObserverService(api, observer);
    registerStatusTool(api, observer);
    registerReviewQueueTool(api, observer);
    registerReviewCommand(api, observer);
    registerChatReviewBridge(api, observer, pluginConfig);

    if (
      pluginConfig.registerContextEngine === true
      && pluginConfig.contextEngineSlot === 'libravdb-adjacent'
      && typeof api.registerContextEngine === 'function'
    ) {
      api.registerContextEngine('revenants', (ctx) => createRevenantsContextEngine({
        ...ctx,
        pluginConfig: {
          ...pluginConfig,
          dataDir: rootDir,
        },
        logger: api.logger,
      }));
      api.logger?.info?.('revenants: registered experimental context engine.');
    } else if (pluginConfig.registerContextEngine === true) {
      api.logger?.warn?.('revenants: context engine registration requested but blocked without contextEngineSlot="libravdb-adjacent".');
    } else {
      api.logger?.info?.('revenants: companion observer mode active; LibraVDB can remain the primary context engine.');
    }
  },
};

function getSharedObserver(ctx) {
  const key = String(ctx.rootDir || 'default');
  let observer = OBSERVER_SINGLETONS.get(key);
  if (!observer) {
    observer = createRevenantsObserver(ctx);
    OBSERVER_SINGLETONS.set(key, observer);
    return observer;
  }

  observer.pluginConfig = { ...observer.pluginConfig, ...ctx.pluginConfig };
  observer.logger = ctx.logger || observer.logger;
  if (typeof ctx.proposalNotifier === 'function') observer.proposalNotifier = ctx.proposalNotifier;
  return observer;
}

function resolvePluginConfig(api, runtimeConfig) {
  const candidates = [
    readConfigSource(api?.config, api),
    readConfigSource(api?.pluginConfig, api),
    readConfigSource(api?.getConfig, api),
    runtimeConfig,
  ];

  return candidates.reduce((merged, candidate) => {
    const normalized = normalizePluginConfig(candidate);
    return normalized ? { ...merged, ...normalized } : merged;
  }, {});
}

function readConfigSource(source, receiver) {
  if (!source) return null;

  if (typeof source === 'function') {
    return callConfigSource(source, receiver, 'revenants')
      ?? callConfigSource(source, receiver);
  }

  if (typeof source.get === 'function') {
    return callConfigSource(source.get, source, 'revenants')
      ?? callConfigSource(source.get, source, 'plugins.revenants')
      ?? callConfigSource(source.get, source);
  }

  return source;
}

function callConfigSource(fn, receiver, key) {
  try {
    return key === undefined ? fn.call(receiver) : fn.call(receiver, key);
  } catch {
    return null;
  }
}

function normalizePluginConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  if (config.revenants && typeof config.revenants === 'object' && !Array.isArray(config.revenants)) {
    return { ...config, ...config.revenants };
  }
  return config;
}

function resolvePluginRootDir(api, pluginConfig) {
  if (typeof pluginConfig.dataDir === 'string' && pluginConfig.dataDir.trim()) {
    return pluginConfig.dataDir;
  }

  const stateDir = api?.runtime?.state?.resolveStateDir?.();
  if (typeof stateDir === 'string' && stateDir.trim()) {
    return `${stateDir.replace(/[\\/]+$/, '')}/revenants`;
  }

  return undefined;
}

function registerObserverService(api, observer) {
  if (typeof api.registerService === 'function') {
    api.registerService({
      id: 'revenants-observer',
      start: () => observer.start(api),
      stop: () => observer.stop(),
    });
    return;
  }

  observer.start(api).catch((error) => {
    api.logger?.error?.(`revenants: observer startup failed: ${error?.message || error}`);
  });
}

function registerStatusTool(api, observer) {
  if (typeof api.registerTool !== 'function') return;

  api.registerTool({
    name: 'revenants_status',
    description: 'Return Revenants observer state, recent trace summaries, and queued LibraVDB promotion signals.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          default: 10,
        },
        includeRaw: {
          type: 'boolean',
          default: false,
        },
      },
    },
    execute: async ({ limit = 10, includeRaw = false } = {}) => {
      const status = observer.getStatus(limit, { includeRaw });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(status, null, 2),
        }],
      };
    },
  });
}

function registerReviewQueueTool(api, observer) {
  if (typeof api.registerTool !== 'function') return;

  api.registerTool({
    name: 'revenants_review_queue',
    description: 'Inspect or acknowledge queued Revenants promotion signals for agent review.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['peek', 'stats', 'ack', 'approve', 'reject', 'defer'],
          default: 'peek',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          default: 10,
        },
        ids: {
          type: 'array',
          items: { type: 'string' },
        },
        reviewer: {
          type: 'string',
        },
        note: {
          type: 'string',
        },
      },
    },
    execute: async ({ action = 'peek', limit = 10, ids = [], reviewer, note } = {}) => {
      const result = observer.reviewQueue(action, { limit, ids, reviewer, note });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
    },
  });
}

function registerReviewCommand(api, observer) {
  if (typeof api.registerCommand !== 'function') return;

  api.registerCommand({
    name: 'revenants',
    description: 'Review queued Revenants evolution proposals from chat.',
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx) => {
      return handleReviewCommand(observer, {
        raw: ctx.args,
        senderId: ctx.senderId,
        sessionKey: ctx.sessionKey,
      });
    },
  });
}

function registerChatReviewBridge(api, observer, pluginConfig) {
  if (typeof api?.on !== 'function') return;
  if (CHAT_BRIDGE_APIS.has(api)) return;
  CHAT_BRIDGE_APIS.add(api);

  const sendReply = createSessionReplySender(api, pluginConfig);

  api.on('message_received', async (event = {}, hookContext = {}) => {
    const command = parseChatReviewCommand(event, hookContext);
    if (!command) return;

    const result = handleReviewCommand(observer, {
      raw: command.args,
      senderId: event?.senderId || hookContext?.senderId,
      sessionKey: event?.sessionKey || hookContext?.sessionKey,
    });

    if (!result?.text) return;

    await sendReply({
      route: {
        channel: event?.channel || event?.sourceChannel || hookContext?.channel || hookContext?.sourceChannel,
        target: routeTargetFromEvent(event, hookContext),
        accountId: event?.accountId || hookContext?.accountId,
        threadId: event?.threadId || hookContext?.threadId,
        replyToId: event?.messageId || hookContext?.messageId,
      },
      message: result.text,
    });
  }, { priority: -40 });
}

function decisionVerb(action) {
  if (action === 'approve') return 'approved';
  if (action === 'reject') return 'rejected';
  if (action === 'defer') return 'deferred';
  return `${action}d`;
}

function formatQueueSummary(result) {
  const lines = [`Queued proposals: ${result.queuedCount}`];
  for (const proposal of (result.recent || []).slice(-5).reverse()) {
    const route = proposal.proposalType ? ` | ${proposal.proposalType} -> ${proposal.mutationTarget}` : '';
    lines.push(`- ${proposal.id} | ${proposal.intent}${route} | ${proposal.summary}`);
  }
  if ((result.recent || []).length === 0) {
    lines.push('- none');
  }
  return lines.join('\n');
}

function createProposalNotifier(api, pluginConfig) {
  if (pluginConfig.notifySessionOnProposal === false) return null;
  return createSessionReplySender(api, pluginConfig, { logPrefix: 'revenants: notified' });
}

function createSessionReplySender(api, pluginConfig, opts = {}) {
  const nativeSend = detectNativeMessageSender(api);

  return async ({ route, message }) => {
    if (!route?.channel || !route?.target || !message) return;
    const payload = {
      channel: route.channel,
      target: route.target,
      message,
      accountId: route.accountId ? String(route.accountId) : undefined,
      threadId: route.threadId !== undefined && route.threadId !== null ? String(route.threadId) : undefined,
      replyToId: route.replyToId ? String(route.replyToId) : undefined,
    };

    if (nativeSend) {
      await nativeSend(payload);
    } else {
      const args = [
        'message',
        'send',
        '--channel',
        route.channel,
        '--target',
        route.target,
        '--message',
        message,
      ];

      if (payload.accountId) args.push('--account', payload.accountId);
      if (payload.threadId) args.push('--thread-id', payload.threadId);
      if (payload.replyToId) args.push('--reply-to', payload.replyToId);

      await execFileAsync('openclaw', args, {
        timeout: Number(pluginConfig.proposalNotifyTimeoutMs) || 15000,
        env: process.env,
      });
    }

    if (opts.logPrefix) api.logger?.info?.(`${opts.logPrefix} ${route.channel}:${route.target}.`);
  };
}

function detectNativeMessageSender(api) {
  if (typeof api?.sendMessage === 'function') {
    return (payload) => api.sendMessage(payload);
  }
  if (typeof api?.message?.send === 'function') {
    return (payload) => api.message.send(payload);
  }
  if (typeof api?.runtime?.message?.send === 'function') {
    return (payload) => api.runtime.message.send(payload);
  }
  return null;
}

function parseChatReviewCommand(event = {}, hookContext = {}) {
  const content = String(event?.content || hookContext?.content || '').trim();
  if (!content) return null;
  const normalized = content.replace(/^<@!?\d+>\s*/u, '').trim();
  const match = normalized.match(/(?:^|\s)revenants(?:\s+(.*))?$/i);
  if (!match) return null;
  return {
    args: String(match[1] || '').trim(),
  };
}

function handleReviewCommand(observer, ctx = {}) {
  const raw = String(ctx.raw || '').trim();
  const [subcommand = 'help', firstArg, ...rest] = raw.split(/\s+/).filter(Boolean);

  if (subcommand === 'queue' || subcommand === 'status' || subcommand === 'help') {
    const result = observer.reviewQueue('peek', { limit: 5 });
    return {
      text: subcommand === 'help'
        ? [
          'Revenants review commands:',
          '- `revenants queue`',
          '- `revenants approve <proposal-id>`',
          '- `revenants reject <proposal-id>`',
          '- `revenants defer <proposal-id>`',
        ].join('\n')
        : formatQueueSummary(result),
    };
  }

  if (subcommand === 'approve' || subcommand === 'reject' || subcommand === 'defer') {
    if (!firstArg) {
      return {
        text: `Missing proposal id. Try \`revenants ${subcommand} <proposal-id>\`.`,
        isError: true,
      };
    }

    const note = rest.join(' ').trim() || undefined;
    const result = observer.reviewQueue(subcommand, {
      ids: [firstArg],
      reviewer: ctx.senderId || ctx.sessionKey || 'chat-reviewer',
      note,
    });

    if (result.acknowledgedCount === 0) {
      return {
        text: `No queued proposal matched \`${firstArg}\`. Try \`revenants queue\`.`,
        isError: true,
      };
    }

    return {
      text: formatReviewDecisionReply(subcommand, result),
    };
  }

  return {
    text: [
      'Revenants review commands:',
      '- `revenants queue`',
      '- `revenants approve <proposal-id>`',
      '- `revenants reject <proposal-id>`',
      '- `revenants defer <proposal-id>`',
    ].join('\n'),
  };
}

function formatReviewDecisionReply(action, result) {
  const reviewed = result?.recentReviewed?.[0];
  const route = reviewed?.proposalType
    ? ` Routed as ${reviewed.proposalType} -> ${reviewed.mutationTarget} via ${reviewed.applyMode}.`
    : '';
  const application = result?.appliedMutations?.[0];
  const applySummary = application?.details ? ` ${application.details}` : '';
  return `Revenants ${decisionVerb(action)} \`${reviewed?.id || 'proposal'}\`. Remaining queued: ${result.remainingCount}.${route}${applySummary}`;
}

function routeTargetFromEvent(event = {}, hookContext = {}) {
  const channelId = event?.channelId || hookContext?.channelId;
  const userId = event?.userId || event?.dmUserId || hookContext?.userId || hookContext?.dmUserId;
  if (channelId) return `channel:${channelId}`;
  if (userId) return `user:${userId}`;
  return null;
}
