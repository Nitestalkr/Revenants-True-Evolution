'use strict';

/**
 * Monitor Suite — orchestrator for all continuous monitors
 *
 * Wires together: BoredomMonitor, StabilityMonitor, ArXivMonitor,
 * optional LegacyCronSignalMonitor, SystemHealthMonitor, AlertSystem
 *
 * Usage:
 *   const suite = new MonitorSuite({ gatewayUrl: 'http://localhost:3000' });
 *   suite.start();
 *   suite.stop();
 */

const EventEmitter = require('events');
const BoredomMonitor = require('./boredom-monitor');
const StabilityMonitor = require('./stability-monitor');
const ArXivMonitor = require('./arxiv-monitor');
const LegacyCronSignalMonitor = require('./cron-health-monitor');
const SystemHealthMonitor = require('./system-health-monitor');
const AlertSystem = require('./alert-system');

class MonitorSuite extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = opts;
    const shared = opts.dataDir ? { dataDir: opts.dataDir } : {};

    this.boredom = new BoredomMonitor({ ...shared, ...(opts.boredom ?? {}) });
    this.stability = new StabilityMonitor({ ...shared, ...(opts.stability ?? {}) });
    this.arxiv = new ArXivMonitor({ ...shared, ...(opts.arxiv ?? {}) });
    this.legacyCronSignals = opts.legacyCronSignals?.enabled === true
      ? new LegacyCronSignalMonitor({ ...shared, ...(opts.legacyCronSignals ?? {}) })
      : null;
    this.systemHealth = new SystemHealthMonitor({
      ...shared,
      gatewayUrl: opts.gatewayUrl ?? 'http://localhost:3000',
      ...(opts.systemHealth ?? {}),
    });
    this.alerts = new AlertSystem({ ...shared, ...(opts.alerts ?? {}) });

    this._running = false;
    this._wireAlerts();
  }

  start() {
    if (this._running) return;
    this._running = true;

    this.boredom.start();
    this.stability.start();
    this.arxiv.start();
    if (this.legacyCronSignals) this.legacyCronSignals.start();
    this.systemHealth.start();

    this.emit('started', { ts: new Date().toISOString() });
    console.log('[MonitorSuite] All monitors started');
  }

  stop() {
    if (!this._running) return;
    this._running = false;

    this.boredom.stop();
    this.stability.stop();
    this.arxiv.stop();
    if (this.legacyCronSignals) this.legacyCronSignals.stop();
    this.systemHealth.stop();

    this.emit('stopped', { ts: new Date().toISOString() });
    console.log('[MonitorSuite] All monitors stopped');
  }

  /** Subscribe an agent session to receive broadcast alerts */
  subscribe(sessionId, handler) {
    this.alerts.subscribe(sessionId, handler);
  }

  unsubscribe(sessionId) {
    this.alerts.unsubscribe(sessionId);
  }

  /** Convenience: report a historical cron-era migration signal when enabled. */
  legacyCronStart(jobName) { this.legacyCronSignals?.reportStart(jobName); }
  legacyCronSuccess(jobName, meta) { this.legacyCronSignals?.reportSuccess(jobName, meta); }
  legacyCronFailure(jobName, reason, meta) { this.legacyCronSignals?.reportFailure(jobName, reason, meta); }
  legacyCronTimeout(jobName, durationMs) { this.legacyCronSignals?.reportTimeout(jobName, durationMs); }

  /** Convenience: signal user activity for boredom suppression */
  userActive() { this.boredom.onUserActivity(); }
  userIdle() { this.boredom.onUserIdle(); }

  /** Get aggregated health snapshot — lean, agent-friendly */
  getSnapshot() {
    return {
      ts: new Date().toISOString(),
      boredom: this.boredom.getState(),
      stability: this.stability.getState(),
      arxiv: this.arxiv.getState(),
      legacyCronSignals: this.legacyCronSignals
        ? this.legacyCronSignals.getState()
        : { enabled: false, reason: 'plugin-native runtime; cron is historical reference only' },
      systemHealth: this.systemHealth.getState(),
      alerts: this.alerts.getAlerts(10),
    };
  }

  /** Drain alert queue for agent payload delivery */
  drainAlerts() {
    return this.alerts.drainQueue();
  }

  _wireAlerts() {
    this.alerts.attachMonitor('boredom', this.boredom);
    this.alerts.attachMonitor('stability', this.stability);
    this.alerts.attachMonitor('arxiv', this.arxiv);
    if (this.legacyCronSignals) this.alerts.attachMonitor('legacyCronSignals', this.legacyCronSignals);
    this.alerts.attachMonitor('systemHealth', this.systemHealth);

    // Bubble alert events up from suite
    this.alerts.on('alert', alert => this.emit('alert', alert));
  }
}

module.exports = MonitorSuite;
