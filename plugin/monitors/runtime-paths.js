'use strict';

const os = require('os');
const path = require('path');

function resolveDefaultDataDir() {
  const stateDir = process.env.OPENCLAW_STATE_DIR;
  const rootDir = stateDir && stateDir.trim()
    ? path.resolve(stateDir, 'revenants')
    : path.join(os.tmpdir(), 'revenants');
  return path.join(rootDir, 'data');
}

module.exports = {
  resolveDefaultDataDir,
};
