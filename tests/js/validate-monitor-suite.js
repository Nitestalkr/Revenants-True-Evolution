'use strict';

/**
 * Validation test for Monitor Suite
 * Runs each monitor in isolation and checks:
 *  - Starts/stops without error
 *  - Emits expected events
 *  - Produces valid state snapshots
 *  - Alert system wires alerts correctly
 */

const MonitorSuite = require('../../plugin/monitors/monitor-suite');
const BoredomMonitor = require('../../plugin/monitors/boredom-monitor');
const CronHealthMonitor = require('../../plugin/monitors/cron-health-monitor');
const AlertSystem = require('../../plugin/monitors/alert-system');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}`);
    failed++;
  }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function testBoredomMonitor() {
  console.log('\n[1] BoredomMonitor');
  const dataDir = makeTempDataDir('revenants-boredom-');
  const m = new BoredomMonitor({ dataDir });
  let sampleCount = 0;
  let alertFired = false;

  m.on('sample', () => sampleCount++);
  m.on('alert', () => { alertFired = true; });

  m.start();
  await delay(6000); // one tick at 5s
  const state = m.getState();

  assert(typeof state.boredom === 'number', 'state.boredom is number');
  assert(state.boredom >= 0 && state.boredom <= 1, 'boredom in [0,1]');
  assert(sampleCount >= 1, 'at least one sample emitted');
  assert(typeof state.idleSec === 'number', 'state.idleSec is number');

  // Test user activity suppression
  const before = state.boredom;
  m.onUserActivity();
  const afterState = m.getState();
  assert(afterState.boredom <= before, 'user activity does not increase boredom');
  assert(!afterState.triggered, 'triggered false after reset');

  try {
    m.stop();
    assert(true, 'stop() does not throw');
  } finally {
    fs.rmSync(path.dirname(dataDir), { recursive: true, force: true });
  }
}

async function testCronHealthMonitor() {
  console.log('\n[2] CronHealthMonitor');
  const dataDir = makeTempDataDir('revenants-cron-health-');
  const m = new CronHealthMonitor({ dataDir });
  let alertFired = false;
  m.on('alert', () => { alertFired = true; });

  m.start();
  m.registerJob('test-cron', { intervalMs: 60000 });
  m.reportStart('test-cron');
  m.reportSuccess('test-cron', { note: 'ok' });

  const state = m.getState();
  assert(state.jobs.length >= 1, 'at least one job tracked');
  const job = state.jobs.find(j => j.name === 'test-cron');
  assert(job !== undefined, 'test-cron job exists');
  assert(job.status === 'ok', 'job status ok after success');

  m.reportFailure('test-cron', 'test failure');
  const failedJob = m.getState().jobs.find(j => j.name === 'test-cron');
  assert(failedJob.status === 'failed', 'job status failed after failure');
  assert(alertFired, 'alert fired on failure');

  try {
    m.stop();
  } finally {
    fs.rmSync(path.dirname(dataDir), { recursive: true, force: true });
  }
}

async function testAlertSystem() {
  console.log('\n[3] AlertSystem + wiring');
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-alerts-'));
  const dataDir = path.join(rootDir, 'data');
  const boredom = new BoredomMonitor({ dataDir });
  const cronHealth = new CronHealthMonitor({ dataDir });
  const alerts = new AlertSystem({ dataDir });

  alerts.attachMonitor('boredom', boredom);
  alerts.attachMonitor('cronHealth', cronHealth);

  let receivedAlert = null;
  alerts.subscribe('test-session', msg => { receivedAlert = msg; });

  // Trigger a cron failure alert
  cronHealth.start();
  cronHealth.reportFailure('some-cron', 'test reason');

  await delay(100);

  assert(receivedAlert !== null, 'subscriber received alert');
  assert(receivedAlert.type === 'monitor_alert', 'alert type is monitor_alert');
  assert(receivedAlert.alert.type === 'cron_failure', 'inner alert type is cron_failure');
  assert(receivedAlert.alert.severity === 'error', 'cron_failure severity is error');
  assert(receivedAlert.alert.payload.job === 'some-cron', 'alert payload has job name');

  const queued = alerts.drainQueue();
  assert(queued.length >= 1, 'queue has at least one item after drainQueue');
  const afterDrain = alerts.drainQueue();
  assert(afterDrain.length === 0, 'queue empty after second drain');

  try {
    cronHealth.stop();
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

async function testMonitorSuite() {
  console.log('\n[4] MonitorSuite orchestrator');
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revenants-suite-'));
  const suite = new MonitorSuite({ gatewayUrl: 'http://localhost:3000', rootDir });

  let alertReceived = false;
  suite.subscribe('agent-1', () => { alertReceived = true; });
  suite.on('alert', () => {});

  suite.start();

  // Report a cron failure to trigger an alert
  suite.cronFailure('heartbeat', 'test failure from validate script');

  await delay(200);

  const snapshot = suite.getSnapshot();
  assert(snapshot.ts != null, 'snapshot has ts');
  assert(snapshot.boredom != null, 'snapshot has boredom');
  assert(snapshot.stability != null, 'snapshot has stability');
  assert(snapshot.cronHealth != null, 'snapshot has cronHealth');
  assert(alertReceived, 'suite subscriber received alert');

  const drained = suite.drainAlerts();
  assert(drained.length >= 1, 'drainAlerts returns queued alerts');

  try {
    suite.stop();
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

function makeTempDataDir(prefix) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), 'data');
}

async function main() {
  console.log('=== Monitor Suite Validation ===');

  try {
    await testBoredomMonitor();
  } catch (e) {
    console.error('BoredomMonitor test threw:', e.message);
    failed++;
  }

  try {
    await testCronHealthMonitor();
  } catch (e) {
    console.error('CronHealthMonitor test threw:', e.message);
    failed++;
  }

  try {
    await testAlertSystem();
  } catch (e) {
    console.error('AlertSystem test threw:', e.message);
    failed++;
  }

  try {
    await testMonitorSuite();
  } catch (e) {
    console.error('MonitorSuite test threw:', e.message);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
