'use strict';

const os = require('os');
const path = require('path');

function resolveRuntimeRoot(config = {}) {
  if (config.dataDir) return path.resolve(config.dataDir);
  if (process.env.OPENCLAW_STATE_DIR) return path.resolve(process.env.OPENCLAW_STATE_DIR, 'revenants');
  return path.join(os.tmpdir(), 'revenants');
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
