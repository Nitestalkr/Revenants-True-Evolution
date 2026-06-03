'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ACTIVE_CRON_PATTERNS = [
  /\bnode-cron\b/i,
  /\bcron-parser\b/i,
  /\bcrontab\b/i,
  /\/etc\/cron/i,
  /\.timer\b/i,
  /\bsystemd\s+timer\b/i,
  /\bregisterCron\s*\(/i,
  /\bcron\.schedule\s*\(/i,
  /\bnew\s+CronJob\s*\(/i,
  /\bAPScheduler\b/i,
  /\bcelery\s+beat\b/i,
];

const HISTORICAL_CRON_PATHS = [
  /^docs\//,
  /^tasks\//,
  /^plugin\/collectors\/.*\.md$/,
  /^plugin\/monitors\/monitor-suite\.md$/,
  /^plugin\/monitors\/cron-health-monitor\.js$/,
  /^plugin\/monitors\/monitor-suite\.js$/,
  /^plugin\/monitors\/alert-system\.js$/,
  /^tests\/js\/validate-monitor-suite\.js$/,
  /^tests\/js\/validate-plugin-native-runtime\.js$/,
  /^tests\/js\/validate-cron-historical-only\.js$/,
];

const EXCLUDED_DIRS = new Set([
  '.git',
  '.pytest_cache',
  'node_modules',
  '__pycache__',
  'data',
  'logs',
  'tmp',
]);

function main() {
  const violations = [];
  for (const file of walk(REPO_ROOT)) {
    const relative = toRepoPath(file);
    const body = fs.readFileSync(file, 'utf8');
    for (const pattern of ACTIVE_CRON_PATTERNS) {
      if (!pattern.test(body)) continue;
      if (isHistoricalCronPath(relative)) continue;
      violations.push(`${relative}: matched ${pattern}`);
    }
  }

  assert.deepStrictEqual(
    violations,
    [],
    `active cron runtime references found:\n${violations.join('\n')}`,
  );

  console.log('cron historical-only guard passed');
}

function isHistoricalCronPath(relative) {
  return HISTORICAL_CRON_PATHS.some((pattern) => pattern.test(relative));
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(absolute);
    } else if (entry.isFile() && isTextFile(entry.name)) {
      yield absolute;
    }
  }
}

function isTextFile(name) {
  return /\.(js|mjs|json|md|py|txt|yml|yaml|toml|ini|sh)$/.test(name);
}

function toRepoPath(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

main();
