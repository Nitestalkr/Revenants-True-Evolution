'use strict';

const fs = require('fs');
const path = require('path');

class DataStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.dataDir = path.join(rootDir, 'data');
    this.tracesFile = path.join(this.dataDir, 'traces.jsonl');
    this.promotionsFile = path.join(this.dataDir, 'promotions.jsonl');
    this.reviewedPromotionsFile = path.join(this.dataDir, 'reviewed-promotions.jsonl');
    this.appliedMutationsFile = path.join(this.dataDir, 'applied-mutations.jsonl');
    this.implementationTasksFile = path.join(this.dataDir, 'implementation-tasks.jsonl');
    this.runtimeConfigFile = path.join(this.dataDir, 'runtime-config-overrides.json');
    this.stateFile = path.join(this.dataDir, 'context-state.json');
  }

  ensure() {
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  appendTrace(trace) {
    this.ensure();
    fs.appendFileSync(this.tracesFile, `${JSON.stringify(trace)}\n`);
  }

  appendPromotion(promotion) {
    this.ensure();
    fs.appendFileSync(this.promotionsFile, `${JSON.stringify(promotion)}\n`);
  }

  readState() {
    this.ensure();
    if (!fs.existsSync(this.stateFile)) return this.defaultState();
    try {
      return { ...this.defaultState(), ...JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) };
    } catch (_) {
      return this.defaultState();
    }
  }

  writeState(nextState) {
    this.ensure();
    const state = {
      ...nextState,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    return state;
  }

  updateState(mutator) {
    const current = this.readState();
    const next = mutator(current) || current;
    return this.writeState(next);
  }

  tailTraces(limit = 20) {
    return this.tailJsonl(this.tracesFile, limit);
  }

  tailPromotions(limit = 20) {
    return this.tailJsonl(this.promotionsFile, limit);
  }

  readPromotions() {
    return this.readJsonl(this.promotionsFile);
  }

  readReviewedPromotions(limit = 20) {
    return this.tailJsonl(this.reviewedPromotionsFile, limit);
  }

  appendAppliedMutation(entry) {
    this.ensure();
    fs.appendFileSync(this.appliedMutationsFile, `${JSON.stringify(entry)}\n`);
  }

  readAppliedMutations(limit = 20) {
    return this.tailJsonl(this.appliedMutationsFile, limit);
  }

  appendImplementationTask(entry) {
    this.ensure();
    fs.appendFileSync(this.implementationTasksFile, `${JSON.stringify(entry)}\n`);
  }

  readImplementationTasks(limit = 20) {
    return this.tailJsonl(this.implementationTasksFile, limit);
  }

  readRuntimeConfig() {
    this.ensure();
    if (!fs.existsSync(this.runtimeConfigFile)) return this.defaultRuntimeConfig();
    try {
      return {
        ...this.defaultRuntimeConfig(),
        ...JSON.parse(fs.readFileSync(this.runtimeConfigFile, 'utf8')),
      };
    } catch (_) {
      return this.defaultRuntimeConfig();
    }
  }

  writeRuntimeConfig(nextConfig) {
    this.ensure();
    const config = {
      ...this.defaultRuntimeConfig(),
      ...nextConfig,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(this.runtimeConfigFile, JSON.stringify(config, null, 2));
    return config;
  }

  acknowledgePromotions(ids = [], meta = {}) {
    return this.reviewPromotions(ids, meta);
  }

  reviewPromotions(ids = [], meta = {}, options = {}) {
    const wanted = new Set((ids || []).map((id) => String(id)));
    if (wanted.size === 0) return { acknowledged: [], remaining: this.readPromotions().length };

    const promotions = this.readPromotions();
    const acknowledged = [];
    const remaining = [];
    const retain = options.retain === true;

    for (const promotion of promotions) {
      if (wanted.has(String(promotion.id))) {
        const reviewed = {
          ...promotion,
          reviewedAt: new Date().toISOString(),
          reviewMeta: meta,
        };
        acknowledged.push(reviewed);
        if (retain) remaining.push(promotion);
      } else {
        remaining.push(promotion);
      }
    }

    if (acknowledged.length > 0) {
      this.ensure();
      fs.appendFileSync(
        this.reviewedPromotionsFile,
        acknowledged.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
      );
      if (!retain) this.writeJsonl(this.promotionsFile, remaining);
    }

    return {
      acknowledged,
      remaining: remaining.length,
    };
  }

  tailJsonl(file, limit = 20) {
    return this.readJsonl(file).slice(-limit);
  }

  readJsonl(file) {
    this.ensure();
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
  }

  writeJsonl(file, entries) {
    this.ensure();
    const body = (entries || []).map((entry) => JSON.stringify(entry)).join('\n');
    fs.writeFileSync(file, body ? `${body}\n` : '');
  }

  defaultState() {
    return {
      schemaVersion: '0.1.0',
      updatedAt: new Date().toISOString(),
      runtime: {
        observerStartedAt: null,
        observerStoppedAt: null,
        lastTraceAt: null,
        monitorsRunning: false,
        serviceStartCount: 0,
      },
      cycleCount: 0,
      driveScores: {
        curiosity: 0.3,
        helpfulness: 0.3,
        competence: 0.4,
        safety: 0.6,
        goal_directed: 0.4,
      },
      grao: {
        activeGradients: [],
        activeProposals: [],
        knownFailureCount: 0,
        lastProposalAt: null,
      },
      counters: {
        messagesIngested: 0,
        turnsObserved: 0,
        toolCallsObserved: 0,
        toolFailuresObserved: 0,
        promotionsQueued: 0,
      },
      sessionRoutes: {},
      notifications: {
        sentPromotions: {},
      },
      autoWork: {
        lastUserActivityAt: null,
        lastAgentActivityAt: null,
        lastEvaluationAt: null,
        lastProposalAt: null,
        lastCandidateKey: null,
      },
    };
  }

  defaultRuntimeConfig() {
    return {
      schemaVersion: '0.1.0',
      updatedAt: new Date().toISOString(),
      proposalThresholds: {},
      toolPolicies: {},
      monitorPolicies: {},
      appliedProposals: {},
    };
  }
}

module.exports = DataStore;
