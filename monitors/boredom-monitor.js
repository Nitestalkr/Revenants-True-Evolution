'use strict';

/**
 * Boredom Monitor — continuous GNW boredom calculation
 * Replaces: GNW Boredom Scan cron (15min interval)
 *
 * Formula: boredom = base_rate * time_idle * (1 - activity_suppression)
 * Threshold: trigger cognitive cycle at >= 0.50
 * Floor: suppress to 0.30 when user is active
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { resolveDataFile } = require('../core/storage-paths');

const THRESHOLD_TRIGGER = 0.50;
const FLOOR_ACTIVE = 0.30;
const BASE_RATE = 0.02; // boredom units per second idle
const SAMPLE_INTERVAL_MS = 5000; // 5s continuous sampling

class BoredomMonitor extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = opts;
    this.dataFile = resolveDataFile(opts, 'boredom-state.json');
    this._timer = null;
    this._boredom = 0;
    this._idleStart = Date.now();
    this._userActive = false;
    this._lastActivity = Date.now();
    this._triggered = false;
    this._history = [];
  }

  start() {
    this._ensureDataDir();
    this._loadState();
    this._timer = setInterval(() => this._tick(), SAMPLE_INTERVAL_MS);
    this.emit('started', { boredom: this._boredom });
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._saveState();
    this.emit('stopped');
  }

  /** Call when user session activity is detected */
  onUserActivity() {
    this._userActive = true;
    this._lastActivity = Date.now();
    if (this._boredom > FLOOR_ACTIVE) {
      this._boredom = FLOOR_ACTIVE;
    }
    this._triggered = false;
  }

  /** Call when user session goes idle */
  onUserIdle() {
    this._userActive = false;
    this._idleStart = Date.now();
  }

  getState() {
    return {
      boredom: this._boredom,
      userActive: this._userActive,
      idleSec: Math.round((Date.now() - this._idleStart) / 1000),
      threshold: THRESHOLD_TRIGGER,
      floor: FLOOR_ACTIVE,
      triggered: this._triggered,
      ts: new Date().toISOString(),
    };
  }

  _tick() {
    const now = Date.now();
    const idleSec = (now - this._idleStart) / 1000;
    const activitySuppression = this._userActive ? 1.0 : 0.0;

    const delta = BASE_RATE * (SAMPLE_INTERVAL_MS / 1000) * (1 - activitySuppression);
    this._boredom = Math.min(1.0, this._boredom + delta);

    if (this._userActive && this._boredom < FLOOR_ACTIVE) {
      this._boredom = FLOOR_ACTIVE;
    }

    const sample = {
      ts: new Date(now).toISOString(),
      boredom: parseFloat(this._boredom.toFixed(4)),
      idleSec: Math.round(idleSec),
      userActive: this._userActive,
    };

    this._history.push(sample);
    if (this._history.length > 720) this._history.shift(); // keep ~1hr at 5s intervals

    if (this._boredom >= THRESHOLD_TRIGGER && !this._triggered) {
      this._triggered = true;
      const payload = {
        type: 'boredom_threshold',
        boredom: this._boredom,
        idleSec: Math.round(idleSec),
        ts: sample.ts,
      };
      this.emit('alert', payload);
      this.emit('cognitive_cycle_trigger', payload);
    }

    this._saveState();
    this.emit('sample', sample);
  }

  _ensureDataDir() {
    const dir = path.dirname(this.dataFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _loadState() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const saved = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
        this._boredom = saved.boredom ?? 0;
        this._triggered = saved.triggered ?? false;
      }
    } catch (_) { /* start fresh */ }
  }

  _saveState() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify({
        boredom: parseFloat(this._boredom.toFixed(4)),
        triggered: this._triggered,
        ts: new Date().toISOString(),
        history: this._history.slice(-12), // last 1min
      }, null, 2));
    } catch (_) { /* non-fatal */ }
  }
}

module.exports = BoredomMonitor;
