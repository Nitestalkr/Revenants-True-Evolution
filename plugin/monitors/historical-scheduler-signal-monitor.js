'use strict';

/**
 * Historical Scheduler Signal Monitor
 *
 * Tracks migration-era scheduler failures for comparison only. This monitor is
 * intentionally opt-in and should not be mistaken for a live cron execution
 * engine.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { resolveDataFile } = require('../core/storage-paths');

class HistoricalSchedulerSignalMonitor extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = opts;
    this.stateFile = resolveDataFile(opts, 'historical-scheduler-signals.json');
    this._timer = null;
    this._jobs = new Map();
    this._enabled = opts.enabled === true;
    this._staleAfterMs = Number(opts.staleAfterMs || 10 * 60 * 1000);
    this._checkIntervalMs = Number(opts.checkIntervalMs || 60 * 1000);
  }

  start() {
    if (!this._enabled || this._timer) return;
    this._ensureDataDir();
    this._timer = setInterval(() => this._checkStaleJobs(), this._checkIntervalMs);
    this.emit('started');
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._saveState();
    this.emit('stopped');
  }

  registerJob(name, meta = {}) {
    const job = this._jobs.get(name) || { name };
    this._jobs.set(name, {
      ...job,
      intervalMs: meta.intervalMs ?? job.intervalMs ?? null,
      note: meta.note ?? job.note ?? null,
    });
  }

  reportStart(name) {
    const now = new Date().toISOString();
    this._jobs.set(name, {
      ...(this._jobs.get(name) || { name }),
      lastStartedAt: now,
      status: 'running',
    });
    this._saveState();
  }

  reportSuccess(name, meta = {}) {
    const now = new Date().toISOString();
    this._jobs.set(name, {
      ...(this._jobs.get(name) || { name }),
      lastSucceededAt: now,
      status: 'ok',
      note: meta.note ?? null,
      durationMs: meta.durationMs ?? null,
    });
    this._saveState();
  }

  reportFailure(name, reason, meta = {}) {
    const now = new Date().toISOString();
    this._jobs.set(name, {
      ...(this._jobs.get(name) || { name }),
      lastFailedAt: now,
      status: 'failed',
      reason,
      note: meta.note ?? null,
    });
    const alert = {
      type: 'historical_scheduler_failure',
      job: name,
      reason,
      ts: now,
    };
    this.emit('alert', alert);
    this._saveState();
  }

  reportTimeout(name, durationMs) {
    this.reportFailure(name, 'timeout', { durationMs });
  }

  getState() {
    return {
      enabled: this._enabled,
      jobs: [...this._jobs.values()],
      ts: new Date().toISOString(),
      reason: 'historical migration signals only; disabled by default in plugin-native runtime',
    };
  }

  _checkStaleJobs() {
    const now = Date.now();
    for (const job of this._jobs.values()) {
      if (!job.intervalMs || !job.lastSucceededAt) continue;
      const ageMs = now - new Date(job.lastSucceededAt).getTime();
      if (ageMs <= Math.max(this._staleAfterMs, Number(job.intervalMs) * 2)) continue;
      this.emit('alert', {
        type: 'historical_scheduler_stale',
        job: job.name,
        ts: new Date().toISOString(),
      });
    }
  }

  _ensureDataDir() {
    const dir = path.dirname(this.stateFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _saveState() {
    try {
      this._ensureDataDir();
      fs.writeFileSync(this.stateFile, JSON.stringify(this.getState(), null, 2));
    } catch (_) { /* non-fatal */ }
  }
}

module.exports = HistoricalSchedulerSignalMonitor;
