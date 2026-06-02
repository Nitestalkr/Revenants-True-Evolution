'use strict';

/**
 * System Health Monitor — gateway status, plugin health, agent status
 * Continuous monitoring of OpenClaw system state.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const CHECK_INTERVAL_MS = 15000; // 15s
const DATA_FILE = path.join(__dirname, '..', 'data', 'system-health.json');

class SystemHealthMonitor extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.gatewayUrl = opts.gatewayUrl ?? 'http://localhost:3000';
    this.pluginEndpoints = opts.pluginEndpoints ?? [];
    this._timer = null;
    this._status = {
      gateway: 'unknown',
      plugins: {},
      agents: {},
    };
    this._history = [];
    this._alerts = [];
  }

  start() {
    this._ensureDataDir();
    this._timer = setInterval(() => this._tick(), CHECK_INTERVAL_MS);
    this._tick();
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

  /** Update agent status from external source */
  updateAgentStatus(agentId, status) {
    const prev = this._status.agents[agentId];
    this._status.agents[agentId] = {
      ...status,
      updatedAt: new Date().toISOString(),
    };
    if (prev?.status !== 'error' && status.status === 'error') {
      const alert = { type: 'agent_error', agentId, reason: status.reason, ts: new Date().toISOString() };
      this._recordAlert(alert);
      this.emit('alert', alert);
    }
  }

  /** Update plugin health from external source */
  updatePluginHealth(pluginName, health) {
    this._status.plugins[pluginName] = {
      ...health,
      updatedAt: new Date().toISOString(),
    };
  }

  getState() {
    return {
      gateway: this._status.gateway,
      plugins: this._status.plugins,
      agents: this._status.agents,
      alertCount: this._alerts.length,
      ts: new Date().toISOString(),
    };
  }

  async _tick() {
    const now = new Date().toISOString();
    const gatewayOk = await this._checkGateway();
    const prevGateway = this._status.gateway;
    this._status.gateway = gatewayOk ? 'ok' : 'unreachable';

    if (prevGateway === 'ok' && !gatewayOk) {
      const alert = { type: 'gateway_down', ts: now };
      this._recordAlert(alert);
      this.emit('alert', alert);
    } else if (prevGateway === 'unreachable' && gatewayOk) {
      this.emit('alert', { type: 'gateway_recovered', ts: now });
    }

    const sample = { ts: now, gateway: this._status.gateway };
    this._history.push(sample);
    if (this._history.length > 240) this._history.shift(); // ~1hr at 15s

    this._saveState();
    this.emit('sample', sample);
  }

  _checkGateway() {
    return new Promise(resolve => {
      const url = new URL('/health', this.gatewayUrl);
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.get(url.toString(), { timeout: 5000 }, res => {
        resolve(res.statusCode >= 200 && res.statusCode < 400);
        res.resume();
      });
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.on('error', () => resolve(false));
    });
  }

  _recordAlert(alert) {
    this._alerts.push(alert);
    if (this._alerts.length > 100) this._alerts.shift();
  }

  _ensureDataDir() {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _saveState() {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify({
        status: this._status,
        alerts: this._alerts.slice(-20),
        history: this._history.slice(-6),
        ts: new Date().toISOString(),
      }, null, 2));
    } catch (_) { /* non-fatal */ }
  }
}

module.exports = SystemHealthMonitor;
