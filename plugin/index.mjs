import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const { createRevenantsContextEngine } = require('./core/context-engine.js');
const { createRevenantsObserver } = require('./core/observer.js');
const execFileAsync = promisify(execFile);

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
    const observer = createRevenantsObserver({
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
      const raw = String(ctx.args || '').trim();
      const [subcommand = 'help', firstArg, ...rest] = raw.split(/\s+/).filter(Boolean);

      if (subcommand === 'queue' || subcommand === 'status') {
        const result = observer.reviewQueue('peek', { limit: 5 });
        return {
          text: formatQueueSummary(result),
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
          text: `Revenants ${decisionVerb(subcommand)} \`${firstArg}\`. Remaining queued: ${result.remainingCount}.`,
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
    },
  });
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
    lines.push(`- ${proposal.id} | ${proposal.intent} | ${proposal.summary}`);
  }
  if ((result.recent || []).length === 0) {
    lines.push('- none');
  }
  return lines.join('\n');
}

function createProposalNotifier(api, pluginConfig) {
  if (pluginConfig.notifySessionOnProposal === false) return null;

  return async ({ route, message }) => {
    if (!route?.channel || !route?.target || !message) return;
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

    if (route.accountId) args.push('--account', String(route.accountId));
    if (route.threadId !== undefined && route.threadId !== null) args.push('--thread-id', String(route.threadId));
    if (route.replyToId) args.push('--reply-to', String(route.replyToId));

    await execFileAsync('openclaw', args, {
      timeout: Number(pluginConfig.proposalNotifyTimeoutMs) || 15000,
      env: process.env,
    });
    api.logger?.info?.(`revenants: notified ${route.channel}:${route.target} about queued proposal.`);
  };
}
