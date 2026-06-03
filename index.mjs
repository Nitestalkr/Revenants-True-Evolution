import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createRevenantsContextEngine } = require('./core/context-engine.js');
const { createRevenantsObserver } = require('./core/observer.js');

const LIBRAVDB_ADJACENT_SLOT = 'libravdb-adjacent';

export default {
  id: 'revenants',
  name: 'Revenants',
  description: 'Companion evolution layer for GNW/GRAO tracing, monitoring, and LibraVDB promotion signals.',
  register(api) {
    const pluginConfig = api.pluginConfig || {};
    const observer = createRevenantsObserver({
      pluginConfig,
      logger: api.logger,
    });

    observer.registerHooks(api);
    registerObserverService(api, observer);
    registerStatusTool(api, observer);

    if (
      pluginConfig.registerContextEngine === true
      && pluginConfig.contextEngineSlot === LIBRAVDB_ADJACENT_SLOT
      && typeof api.registerContextEngine === 'function'
    ) {
      api.registerContextEngine('revenants', (ctx) => createRevenantsContextEngine({
        ...ctx,
        pluginConfig,
        logger: api.logger,
      }));
      api.logger?.info?.('revenants: registered experimental LibraVDB-adjacent context engine.');
    } else if (pluginConfig.registerContextEngine === true) {
      api.logger?.warn?.(`revenants: context engine registration blocked; LibraVDB remains authority unless contextEngineSlot="${LIBRAVDB_ADJACENT_SLOT}".`);
    } else {
      api.logger?.info?.('revenants: companion observer mode active; LibraVDB can remain the primary context engine.');
    }
  },
};

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
