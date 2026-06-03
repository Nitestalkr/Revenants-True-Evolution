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
const LegacyCronSignalMonitor = require('../../plugin/monitors/cron-health-monitor');
const AlertSystem = require('../../plugin/monitors/alert-system');

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
  const m = new BoredomMonitor();
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

  m.stop();
  assert(true, 'stop() does not throw');
}

async function testLegacyCronSignalMonitor() {
  console.log('\n[2] LegacyCronSignalMonitor');
  const m = new LegacyCronSignalMonitor();
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
  assert(alertFired, 'alert fired on legacy cron failure');

  m.stop();
}

async function testAlertSystem() {
  console.log('\n[3] AlertSystem + wiring');
  const boredom = new BoredomMonitor();
  const legacyCronSignals = new LegacyCronSignalMonitor();
  const alerts = new AlertSystem();

  alerts.attachMonitor('boredom', boredom);
  alerts.attachMonitor('legacyCronSignals', legacyCronSignals);

  let receivedAlert = null;
  alerts.subscribe('test-session', msg => { receivedAlert = msg; });

  // Trigger a historical cron signal failure alert
  legacyCronSignals.start();
  legacyCronSignals.reportFailure('some-cron', 'test reason');

  await delay(100);

  assert(receivedAlert !== null, 'subscriber received alert');
  assert(receivedAlert.type === 'monitor_alert', 'alert type is monitor_alert');
  assert(receivedAlert.alert.type === 'legacy_cron_failure', 'inner alert type is legacy_cron_failure');
  assert(receivedAlert.alert.severity === 'error', 'legacy cron failure severity is error');
  assert(receivedAlert.alert.payload.job === 'some-cron', 'alert payload has job name');

  const queued = alerts.drainQueue();
  assert(queued.length >= 1, 'queue has at least one item after drainQueue');
  const afterDrain = alerts.drainQueue();
  assert(afterDrain.length === 0, 'queue empty after second drain');

  legacyCronSignals.stop();
}

async function testMonitorSuite() {
  console.log('\n[4] MonitorSuite orchestrator');
  const suite = new MonitorSuite({ gatewayUrl: 'http://localhost:3000' });

  let alertReceived = false;
  suite.subscribe('agent-1', () => { alertReceived = true; });
  suite.on('alert', () => {});

  suite.start();

  await delay(200);

  const snapshot = suite.getSnapshot();
  assert(snapshot.ts != null, 'snapshot has ts');
  assert(snapshot.boredom != null, 'snapshot has boredom');
  assert(snapshot.stability != null, 'snapshot has stability');
  assert(snapshot.legacyCronSignals != null, 'snapshot has legacyCronSignals');
  assert(snapshot.legacyCronSignals.enabled === false, 'legacy cron signals disabled by default');
  assert(!alertReceived, 'default suite does not emit cron alerts');

  const drained = suite.drainAlerts();
  assert(drained.length === 0, 'drainAlerts is empty without explicit legacy cron input');

  suite.stop();
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
    await testLegacyCronSignalMonitor();
  } catch (e) {
    console.error('LegacyCronSignalMonitor test threw:', e.message);
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
