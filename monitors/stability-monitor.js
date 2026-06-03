'use strict';

/**
 * Stability Monitor — continuous system health tracking
 * Replaces: Stability Monitor cron (periodic snapshots)
 *
 * Monitors: memory, CPU, drive health, cron status
 */

const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveDataFile } = require('../core/storage-paths');

const SAMPLE_INTERVAL_MS = 10000; // 10s

const THRESHOLDS = {
  memUsedPct: 85,  // alert if >85% RAM used
  cpuLoadAvg: 90,  // alert if 1min load avg >90%
  diskUsedPct: 90, // alert if >90% disk used
};

class StabilityMonitor extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = opts;
    this.dataFile = resolveDataFile(opts, 'stability-state.json');
    this.alertFile = resolveDataFile(opts, 'stability-alerts.json');
    this._timer = null;
    this._alerts = [];
    this._history = [];
    this._cronStatuses = {};
  }

  start() {
    this._ensureDataDir();
    this._timer = setInterval(() => this._tick(), SAMPLE_INTERVAL_MS);
    this._tick(); // immediate first sample
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

  /** Update cron job status from external source */
  updateCronStatus(jobName, status) {
    this._cronStatuses[jobName] = {
      ...status,
      updatedAt: new Date().toISOString(),
    };
    if (status.failed) {
      const alert = {
        type: 'cron_failure',
        job: jobName,
        reason: status.reason ?? 'unknown',
        ts: new Date().toISOString(),
      };
      this._recordAlert(alert);
      this.emit('alert', alert);
    }
  }

  getState() {
    return {
      memory: this._getMemoryMetrics(),
      cpu: this._getCpuMetrics(),
      disk: this._getDiskMetrics(),
      cron: this._cronStatuses,
      alertCount: this._alerts.length,
      ts: new Date().toISOString(),
    };
  }

  _tick() {
    const mem = this._getMemoryMetrics();
    const cpu = this._getCpuMetrics();
    const disk = this._getDiskMetrics();
    const now = new Date().toISOString();

    const sample = { ts: now, mem, cpu, disk };
    this._history.push(sample);
    if (this._history.length > 360) this._history.shift(); // ~1hr at 10s

    // Check thresholds
    if (mem.usedPct > THRESHOLDS.memUsedPct) {
      this._recordAlert({ type: 'high_memory', value: mem.usedPct, threshold: THRESHOLDS.memUsedPct, ts: now });
      this.emit('alert', { type: 'high_memory', value: mem.usedPct, ts: now });
    }

    if (cpu.loadPct > THRESHOLDS.cpuLoadAvg) {
      this._recordAlert({ type: 'high_cpu', value: cpu.loadPct, threshold: THRESHOLDS.cpuLoadAvg, ts: now });
      this.emit('alert', { type: 'high_cpu', value: cpu.loadPct, ts: now });
    }

    this._saveState();
    this.emit('sample', sample);
  }

  _getMemoryMetrics() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
      totalMB: Math.round(total / 1024 / 1024),
      usedMB: Math.round(used / 1024 / 1024),
      freeMB: Math.round(free / 1024 / 1024),
      usedPct: parseFloat((used / total * 100).toFixed(1)),
    };
  }

  _getCpuMetrics() {
    const loads = os.loadavg(); // [1min, 5min, 15min] — works on Linux/Mac; 0 on Windows
    const cpuCount = os.cpus().length;
    const load1 = loads[0];
    const loadPct = cpuCount > 0 ? parseFloat((load1 / cpuCount * 100).toFixed(1)) : 0;
    return {
      cpuCount,
      load1min: parseFloat(load1.toFixed(2)),
      load5min: parseFloat(loads[1].toFixed(2)),
      loadPct,
    };
  }

  _getDiskMetrics() {
    // Windows-compatible disk check via statfs if available (Node 18+), else skip
    try {
      if (fs.statfsSync) {
        const stat = fs.statfsSync('D:\\');
        const total = stat.blocks * stat.bsize;
        const free = stat.bfree * stat.bsize;
        const used = total - free;
        return {
          totalGB: parseFloat((total / 1024 / 1024 / 1024).toFixed(1)),
          usedGB: parseFloat((used / 1024 / 1024 / 1024).toFixed(1)),
          freeGB: parseFloat((free / 1024 / 1024 / 1024).toFixed(1)),
          usedPct: parseFloat((used / total * 100).toFixed(1)),
        };
      }
    } catch (_) { /* not available */ }
    return { note: 'disk metrics unavailable on this platform/version' };
  }

  _recordAlert(alert) {
    this._alerts.push(alert);
    if (this._alerts.length > 100) this._alerts.shift();
    try {
      fs.writeFileSync(this.alertFile, JSON.stringify(this._alerts, null, 2));
    } catch (_) { /* non-fatal */ }
  }

  _ensureDataDir() {
    const dir = path.dirname(this.dataFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _saveState() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify({
        current: this.getState(),
        history: this._history.slice(-6),
        cron: this._cronStatuses,
        ts: new Date().toISOString(),
      }, null, 2));
    } catch (_) { /* non-fatal */ }
  }
}

module.exports = StabilityMonitor;
