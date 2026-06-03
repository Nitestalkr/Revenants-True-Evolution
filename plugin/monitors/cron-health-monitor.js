'use strict';

/**
 * Cron Health Monitor — real-time cron execution tracking and failure detection
 * Replaces: Cron Health Monitor cron (periodic check)
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { resolveDefaultDataDir } = require('./runtime-paths');

const CHECK_INTERVAL_MS = 30000; // 30s
const TIMEOUT_TOLERANCE_MS = 60000; // flag if cron hasn't reported in 2x expected interval

class CronHealthMonitor extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = opts;
    this.dataDir = opts.dataDir ?? resolveDefaultDataDir();
    this.dataFile = path.join(this.dataDir, 'cron-health.json');
    this._timer = null;
    this._jobs = {}; // name -> { lastRun, lastSuccess, failures, interval, status }
    this._alerts = [];
  }

  start() {
    this._ensureDataDir();
    this._loadState();
    this._timer = setInterval(() => this._check(), CHECK_INTERVAL_MS);
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

  /** Register a cron job to track */
  registerJob(name, opts = {}) {
    if (!this._jobs[name]) {
      this._jobs[name] = {
        name,
        intervalMs: opts.intervalMs ?? null,
        lastRun: null,
        lastSuccess: null,
        lastFailure: null,
        failures: 0,
        totalRuns: 0,
        status: 'registered',
        reason: null,
      };
    }
  }

  /** Call when a cron job starts execution */
  reportStart(name) {
    const job = this._ensureJob(name);
    job.lastRun = new Date().toISOString();
    job.totalRuns++;
    job.status = 'running';
    this._saveState();
  }

  /** Call when a cron job completes successfully */
  reportSuccess(name, meta = {}) {
    const job = this._ensureJob(name);
    job.lastSuccess = new Date().toISOString();
    job.status = 'ok';
    job.reason = null;
    this.emit('job_ok', { name, ts: job.lastSuccess, ...meta });
    this._saveState();
  }

  /** Call when a cron job fails */
  reportFailure(name, reason = 'unknown', meta = {}) {
    const job = this._ensureJob(name);
    job.lastFailure = new Date().toISOString();
    job.failures++;
    job.status = 'failed';
    job.reason = reason;

    const alert = {
      type: 'cron_failure',
      job: name,
      reason,
      failures: job.failures,
      ts: job.lastFailure,
      ...meta,
    };
    this._recordAlert(alert);
    this.emit('alert', alert);
    this.emit('job_failed', alert);
    this._saveState();
  }

  /** Call when a cron job times out */
  reportTimeout(name, durationMs) {
    this.reportFailure(name, `timeout after ${Math.round(durationMs / 1000)}s`);
    this.emit('job_timeout', { name, durationMs, ts: new Date().toISOString() });
  }

  getState() {
    return {
      jobs: Object.values(this._jobs),
      alertCount: this._alerts.length,
      recentAlerts: this._alerts.slice(-5),
      ts: new Date().toISOString(),
    };
  }

  _check() {
    const now = Date.now();
    for (const job of Object.values(this._jobs)) {
      if (!job.intervalMs || !job.lastRun) continue;
      const elapsed = now - new Date(job.lastRun).getTime();
      const expectedMax = job.intervalMs + TIMEOUT_TOLERANCE_MS;
      if (elapsed > expectedMax && job.status !== 'stale') {
        job.status = 'stale';
        const alert = {
          type: 'cron_stale',
          job: job.name,
          elapsedMs: elapsed,
          expectedMs: job.intervalMs,
          ts: new Date().toISOString(),
        };
        this._recordAlert(alert);
        this.emit('alert', alert);
      }
    }
    this._saveState();
  }

  _ensureJob(name) {
    if (!this._jobs[name]) this.registerJob(name);
    return this._jobs[name];
  }

  _recordAlert(alert) {
    this._alerts.push(alert);
    if (this._alerts.length > 200) this._alerts.shift();
  }

  _ensureDataDir() {
    const dir = path.dirname(this.dataFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _loadState() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const saved = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
        this._jobs = saved.jobs ?? {};
        this._alerts = saved.alerts ?? [];
      }
    } catch (_) { /* start fresh */ }
  }

  _saveState() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify({
        jobs: this._jobs,
        alerts: this._alerts.slice(-50),
        ts: new Date().toISOString(),
      }, null, 2));
    } catch (_) { /* non-fatal */ }
  }
}

module.exports = CronHealthMonitor;
