'use strict';

const fs = require('fs');
const path = require('path');

class DataStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.dataDir = path.join(rootDir, 'data');
    this.tracesFile = path.join(this.dataDir, 'traces.jsonl');
    this.promotionsFile = path.join(this.dataDir, 'promotions.jsonl');
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

  tailJsonl(file, limit = 20) {
    this.ensure();
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
  }

  defaultState() {
    return {
      schemaVersion: '0.1.0',
      updatedAt: new Date().toISOString(),
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
    };
  }
}

module.exports = DataStore;
