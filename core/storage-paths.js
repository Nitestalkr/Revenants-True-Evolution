'use strict';

const os = require('os');
const path = require('path');

function resolveRuntimeRoot(config = {}) {
  if (config.dataDir) return path.resolve(config.dataDir);
  if (process.env.OPENCLAW_STATE_DIR) return path.join(process.env.OPENCLAW_STATE_DIR, 'revenants');
  if (process.env.XDG_STATE_HOME) return path.join(process.env.XDG_STATE_HOME, 'openclaw', 'revenants');
  return path.join(os.tmpdir(), 'openclaw-revenants');
}

function resolveDataDir(config = {}) {
  return path.join(resolveRuntimeRoot(config), 'data');
}

function resolveDataFile(config = {}, filename) {
  return path.join(resolveDataDir(config), filename);
}

module.exports = {
  resolveRuntimeRoot,
  resolveDataDir,
  resolveDataFile,
};
