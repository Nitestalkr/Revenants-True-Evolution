'use strict';

/**
 * Monitor Suite — orchestrator for all continuous monitors
 *
 * Wires together: BoredomMonitor, StabilityMonitor, optional ArXivMonitor as
 * research-evolution source, optional HistoricalSchedulerSignalMonitor,
 * SystemHealthMonitor, AlertSystem
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
const HistoricalSchedulerSignalMonitor = require('./historical-scheduler-signal-monitor');
const SystemHealthMonitor = require('./system-health-monitor');
const AlertSystem = require('./alert-system');

class MonitorSuite extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = opts;
    const shared = opts.dataDir ? { dataDir: opts.dataDir } : {};
    const researchEvolutionEnabled = opts.researchEvolution?.enabled === true
      || opts.arxiv?.enabled === true;

    this.boredom = new BoredomMonitor({ ...shared, ...(opts.boredom ?? {}) });
    this.stability = new StabilityMonitor({ ...shared, ...(opts.stability ?? {}) });
    this.arxiv = researchEvolutionEnabled
      ? new ArXivMonitor({
          ...shared,
          ...(opts.arxiv ?? {}),
          ...(opts.researchEvolution ?? {}),
        })
      : null;
    const historicalSchedulerSignalsConfig = opts.historicalSchedulerSignals ?? opts.legacyCronSignals ?? {};
    this.historicalSchedulerSignals = historicalSchedulerSignalsConfig.enabled === true
      ? new HistoricalSchedulerSignalMonitor({ ...shared, ...historicalSchedulerSignalsConfig, enabled: true })
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
    if (this.arxiv) this.arxiv.start();
    if (this.historicalSchedulerSignals) this.historicalSchedulerSignals.start();
    this.systemHealth.start();

    this.emit('started', { ts: new Date().toISOString() });
    console.log('[MonitorSuite] All monitors started');
  }

  stop() {
    if (!this._running) return;
    this._running = false;

    this.boredom.stop();
    this.stability.stop();
    if (this.arxiv) this.arxiv.stop();
    if (this.historicalSchedulerSignals) this.historicalSchedulerSignals.stop();
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

  /** Convenience: report a historical scheduler-era migration signal when enabled. */
  historicalSchedulerStart(jobName) { this.historicalSchedulerSignals?.reportStart(jobName); }
  historicalSchedulerSuccess(jobName, meta) { this.historicalSchedulerSignals?.reportSuccess(jobName, meta); }
  historicalSchedulerFailure(jobName, reason, meta) { this.historicalSchedulerSignals?.reportFailure(jobName, reason, meta); }
  historicalSchedulerTimeout(jobName, durationMs) { this.historicalSchedulerSignals?.reportTimeout(jobName, durationMs); }

  /** Convenience: signal user activity for boredom suppression */
  userActive() { this.boredom.onUserActivity(); }
  userIdle() { this.boredom.onUserIdle(); }

  /** Get aggregated health snapshot — lean, agent-friendly */
  getSnapshot() {
    const researchEvolution = this.arxiv
      ? this.arxiv.getState()
      : {
          enabled: false,
          mode: 'research-evolution-source',
          reason: 'optional research-evolution lane; disabled unless explicitly enabled',
        };
    return {
      ts: new Date().toISOString(),
      boredom: this.boredom.getState(),
      stability: this.stability.getState(),
      researchEvolution,
      arxiv: researchEvolution,
      historicalSchedulerSignals: this.historicalSchedulerSignals
        ? this.historicalSchedulerSignals.getState()
        : { enabled: false, reason: 'plugin-native runtime; scheduler migration signals are historical reference only' },
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
    if (this.arxiv) this.alerts.attachMonitor('researchEvolution', this.arxiv);
    if (this.historicalSchedulerSignals) this.alerts.attachMonitor('historicalSchedulerSignals', this.historicalSchedulerSignals);
    this.alerts.attachMonitor('systemHealth', this.systemHealth);

    // Bubble alert events up from suite
    this.alerts.on('alert', alert => this.emit('alert', alert));
  }
}

module.exports = MonitorSuite;
