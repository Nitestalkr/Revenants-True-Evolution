'use strict';

/**
 * Alert Trigger System — aggregates alerts from all monitors and broadcasts
 * to agent sessions.
 *
 * Agents receive lean payloads (type, severity, context) — no raw data dumps.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const ALERT_FILE = path.join(__dirname, '..', 'data', 'alerts.json');
const BROADCAST_FILE = path.join(__dirname, '..', 'data', 'broadcast-queue.json');

const SEVERITY = {
  boredom_threshold: 'info',
  cognitive_cycle_trigger: 'info',
  high_memory: 'warning',
  high_cpu: 'warning',
  cron_failure: 'error',
  cron_stale: 'warning',
  arxiv_paper: 'info',
  gateway_down: 'critical',
  gateway_recovered: 'info',
  agent_error: 'error',
};

class AlertSystem extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = opts;
    this._alerts = [];
    this._queue = [];
    this._subscribers = new Map(); // sessionId -> handler fn
  }

  /** Wire up a monitor — listens for its 'alert' events */
  attachMonitor(name, monitor) {
    monitor.on('alert', alert => this._handleAlert(name, alert));
    monitor.on('cognitive_cycle_trigger', payload => {
      this._handleAlert(name, { type: 'cognitive_cycle_trigger', ...payload });
    });
  }

  /** Subscribe an agent session to receive broadcast payloads */
  subscribe(sessionId, handler) {
    this._subscribers.set(sessionId, handler);
  }

  unsubscribe(sessionId) {
    this._subscribers.delete(sessionId);
  }

  /** Get recent alerts for agent consumption */
  getAlerts(limit = 20) {
    return this._alerts.slice(-limit);
  }

  /** Get pending broadcast queue and clear it */
  drainQueue() {
    const items = [...this._queue];
    this._queue = [];
    this._saveBroadcastQueue();
    return items;
  }

  _handleAlert(source, rawAlert) {
    const alert = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      source,
      type: rawAlert.type,
      severity: SEVERITY[rawAlert.type] ?? 'info',
      ts: rawAlert.ts ?? new Date().toISOString(),
      payload: this._leanPayload(rawAlert),
    };

    this._alerts.push(alert);
    if (this._alerts.length > 500) this._alerts.shift();

    this._queue.push(alert);
    if (this._queue.length > 100) this._queue.shift();

    this._saveAlerts();
    this._saveBroadcastQueue();

    // Broadcast to subscribed agent sessions
    this._broadcast(alert);

    this.emit('alert', alert);
  }

  _leanPayload(raw) {
    // Strip large fields, keep only what agents need
    const { type, ts, ...rest } = raw;
    const lean = {};
    const allowed = ['boredom', 'idleSec', 'value', 'threshold', 'job', 'reason',
                     'failures', 'paper', 'agentId', 'durationMs', 'elapsedMs'];
    for (const key of allowed) {
      if (rest[key] !== undefined) lean[key] = rest[key];
    }
    // For paper alerts, trim to just id+title (not full abstract)
    if (lean.paper) {
      lean.paper = { id: lean.paper.id, title: lean.paper.title, published: lean.paper.published };
    }
    return lean;
  }

  _broadcast(alert) {
    if (this._subscribers.size === 0) return;
    const msg = {
      type: 'monitor_alert',
      alert,
      ts: new Date().toISOString(),
    };
    for (const [sessionId, handler] of this._subscribers) {
      try {
        handler(msg);
      } catch (err) {
        this.emit('broadcast_error', { sessionId, error: err.message });
      }
    }
  }

  _saveAlerts() {
    try {
      const dir = path.dirname(ALERT_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(ALERT_FILE, JSON.stringify({
        alerts: this._alerts.slice(-100),
        ts: new Date().toISOString(),
      }, null, 2));
    } catch (_) { /* non-fatal */ }
  }

  _saveBroadcastQueue() {
    try {
      const dir = path.dirname(BROADCAST_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(BROADCAST_FILE, JSON.stringify({
        queue: this._queue,
        ts: new Date().toISOString(),
      }, null, 2));
    } catch (_) { /* non-fatal */ }
  }
}

module.exports = AlertSystem;
