import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createRevenantsContextEngine } = require('./core/context-engine.js');
const { createRevenantsObserver } = require('./core/observer.js');

export default {
  id: 'revenants',
  name: 'Revenants',
  description: 'Companion evolution layer for GNW/GRAO tracing, monitoring, and LibraVDB promotion signals.',
  register(api) {
    const pluginConfig = api.pluginConfig || {};
    if (pluginConfig.enabled === false) {
      api.logger?.info?.('revenants: plugin disabled by config.');
      return;
    }

    const rootDir = resolvePluginRootDir(api, pluginConfig);
    const observer = createRevenantsObserver({
      pluginConfig,
      rootDir,
      logger: api.logger,
    });

    observer.registerHooks(api);
    registerObserverService(api, observer);
    registerStatusTool(api, observer);

    if (pluginConfig.registerContextEngine === true && typeof api.registerContextEngine === 'function') {
      api.registerContextEngine('revenants', (ctx) => createRevenantsContextEngine({
        ...ctx,
        pluginConfig: {
          ...pluginConfig,
          dataDir: rootDir,
        },
        logger: api.logger,
      }));
      api.logger?.info?.('revenants: registered experimental context engine.');
    } else {
      api.logger?.info?.('revenants: companion observer mode active; LibraVDB can remain the primary context engine.');
    }
  },
};

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
      },
    },
    execute: async ({ limit = 10 } = {}) => {
      const status = observer.getStatus(limit);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(status, null, 2),
        }],
      };
    },
  });
}
