'use strict';

/**
 * Monitor Suite — orchestrator for all continuous monitors
 *
 * Wires together: BoredomMonitor, StabilityMonitor, ArXivMonitor,
 * CronHealthMonitor, SystemHealthMonitor, AlertSystem
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
const CronHealthMonitor = require('./cron-health-monitor');
const SystemHealthMonitor = require('./system-health-monitor');
const AlertSystem = require('./alert-system');

class MonitorSuite extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = opts;

    this.boredom = new BoredomMonitor(opts.boredom ?? {});
    this.stability = new StabilityMonitor(opts.stability ?? {});
    this.arxiv = new ArXivMonitor(opts.arxiv ?? {});
    this.cronHealth = new CronHealthMonitor(opts.cronHealth ?? {});
    this.systemHealth = new SystemHealthMonitor({
      gatewayUrl: opts.gatewayUrl ?? 'http://localhost:3000',
      ...(opts.systemHealth ?? {}),
    });
    this.alerts = new AlertSystem(opts.alerts ?? {});

    this._running = false;
    this._wireAlerts();
  }

  start() {
    if (this._running) return;
    this._running = true;

    this.boredom.start();
    this.stability.start();
    this.arxiv.start();
    this.cronHealth.start();
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
    this.cronHealth.stop();
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

  /** Convenience: report a cron job event */
  cronStart(jobName) { this.cronHealth.reportStart(jobName); }
  cronSuccess(jobName, meta) { this.cronHealth.reportSuccess(jobName, meta); }
  cronFailure(jobName, reason, meta) { this.cronHealth.reportFailure(jobName, reason, meta); }
  cronTimeout(jobName, durationMs) { this.cronHealth.reportTimeout(jobName, durationMs); }

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
      cronHealth: this.cronHealth.getState(),
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
    this.alerts.attachMonitor('cronHealth', this.cronHealth);
    this.alerts.attachMonitor('systemHealth', this.systemHealth);

    // Bubble alert events up from suite
    this.alerts.on('alert', alert => this.emit('alert', alert));
  }
}

module.exports = MonitorSuite;
