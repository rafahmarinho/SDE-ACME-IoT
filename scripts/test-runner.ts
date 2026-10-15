// ACME IoT Functional and Integration Test Runner
import assert from 'assert';
import {
  INITIAL_ORGANIZATIONS,
  INITIAL_USERS,
  INITIAL_BUILDINGS,
  INITIAL_ROOMS,
  INITIAL_DEVICES,
  INITIAL_AUTOMATIONS,
  INITIAL_ALERTS,
  INITIAL_FIRMWARE_PACKAGES,
  INITIAL_FIRMWARE_ROLLOUTS,
} from '../src/mock/initialData';
import { AppStorage } from '../src/services/storage';
import { SimulationEngine } from '../src/services/simulation';
import { hasPermission, sanitizeString, checkRateLimit } from '../src/services/security';

console.log('--- STARTING ACME IOT TEST SUITE ---');

// Test 1: Verify Seed Data Integrity
console.log('\n[Test 1] Validating Seed Data & Domain Models...');
assert(INITIAL_ORGANIZATIONS.length === 2, 'Must have 2 organizations');
assert(INITIAL_DEVICES.length === 20, 'Must have 20 initial devices');
assert(INITIAL_USERS.length === 4, 'Must have 4 persona users covering RBAC');
assert(INITIAL_BUILDINGS.length === 4, 'Must have 4 buildings across organizations');
assert(INITIAL_ROOMS.length === 6, 'Must have 6 rooms across buildings');
assert(INITIAL_AUTOMATIONS.length >= 3, 'Must have initial automations');
assert(INITIAL_FIRMWARE_PACKAGES.length >= 3, 'Must have firmware packages');
console.log('✓ Seed data verified: 2 organizations, 20 devices, 4 roles, 4 buildings, 6 rooms.');

// Test 2: Device Types and States
console.log('\n[Test 2] Validating Device Types and Desired vs Reported State Separation...');
const deviceTypes = new Set(INITIAL_DEVICES.map((d) => d.type));
assert(deviceTypes.has('thermostat'), 'Must support thermostats');
assert(deviceTypes.has('smart_plug'), 'Must support smart plugs');
assert(deviceTypes.has('temperature_sensor'), 'Must support temperature sensors');
assert(deviceTypes.has('humidity_sensor'), 'Must support humidity sensors');
assert(deviceTypes.has('occupancy_sensor'), 'Must support occupancy sensors');

INITIAL_DEVICES.forEach((dev) => {
  assert(dev.desiredState !== undefined, `Device ${dev.code} missing desiredState`);
  assert(dev.reportedState !== undefined, `Device ${dev.code} missing reportedState`);
});
console.log('✓ All 5 device types present with distinct desired and reported states.');

// Test 3: RBAC Roles and Permission Matrix
console.log('\n[Test 3] Validating Role-Based Access Control (RBAC)...');
assert(hasPermission('owner', 'devices:control') === true, 'Owner should control devices');
assert(hasPermission('owner', 'team:manage') === true, 'Owner should manage team');
assert(hasPermission('administrator', 'firmware:manage') === true, 'Admin should manage firmware');
assert(hasPermission('operator', 'devices:control') === true, 'Operator should control devices');
assert(hasPermission('operator', 'team:manage') === false, 'Operator should NOT manage team');
assert(hasPermission('viewer', 'devices:read') === true, 'Viewer should read devices');
assert(hasPermission('viewer', 'devices:control') === false, 'Viewer should NOT control devices');
console.log('✓ RBAC enforcement validated: Owner, Admin, Operator, Viewer constraints hold.');

// Test 4: Simulation Engine & Scenarios
console.log('\n[Test 4] Validating Simulation Engine Tick and Advance...');
AppStorage.resetToDemoData();
const advanceResult = SimulationEngine.advanceTick();
assert(advanceResult.updatedDevices === 20, 'Should tick all 20 devices');
console.log(`✓ Simulation advanced 1 tick: ${advanceResult.updatedDevices} devices updated, ${advanceResult.triggeredAutomations} automations evaluated.`);

// Test 5: Offline Mode Behavior
console.log('\n[Test 5] Validating Offline Resilience and Control Action Rejection...');
AppStorage.setOfflineMode(true);
assert(AppStorage.isOfflineMode() === true, 'Should be in offline mode');
const offlineAttempt = SimulationEngine.updateDesiredState(INITIAL_DEVICES[0].id, { target_temp: 24.5 });
assert(offlineAttempt.success === false, 'Control actions must fail when offline');
assert(offlineAttempt.error?.includes('offline mode'), 'Error message must specify offline restriction');
AppStorage.setOfflineMode(false);
const onlineAttempt = SimulationEngine.updateDesiredState(INITIAL_DEVICES[0].id, { target_temp: 24.5 });
assert(onlineAttempt.success === true, 'Control actions must succeed when online');
console.log('✓ Offline mode correctly locks mutations and resumes on reconnect.');

// Test 6: Security Helpers (Sanitization & Rate Limiter)
console.log('\n[Test 6] Validating Security Controls (Sanitization & Rate Limiting)...');
const rawXSS = '<script>alert("xss")</script>';
const sanitized = sanitizeString(rawXSS);
assert(!sanitized.includes('<script>'), 'Sanitization must escape tags');
assert(sanitized.includes('&lt;script&gt;'), 'Sanitization must produce entity encoding');

const rl1 = checkRateLimit('test_client_ip', 5, 10000);
assert(rl1.allowed === true, 'First request within rate limit must pass');
for (let i = 0; i < 4; i++) checkRateLimit('test_client_ip', 5, 10000);
const rlBlocked = checkRateLimit('test_client_ip', 5, 10000);
assert(rlBlocked.allowed === false, 'Excessive requests must be throttled');
console.log('✓ Input sanitization (XSS) and Rate limiting (DoS) verified.');

// Test 7: Firmware Checksums & OTA Rollback
console.log('\n[Test 7] Validating Firmware Checksum & OTA Rollout Integrity...');
INITIAL_FIRMWARE_PACKAGES.forEach((pkg) => {
  assert(pkg.checksumSha256 && pkg.checksumSha256.length === 64, `Firmware ${pkg.version} invalid SHA-256`);
});
const rolloutId = INITIAL_FIRMWARE_ROLLOUTS[0].id;
SimulationEngine.rollbackRollout(rolloutId);
const rollouts = AppStorage.getFirmwareRollouts();
const rolledBack = rollouts.find((r) => r.id === rolloutId);
assert(rolledBack?.status === 'rolled_back', 'Rollout should transition to rolled_back');
console.log('✓ Firmware signatures and OTA rollback simulation verified.');

console.log('\n=============================================');
console.log('ALL ACME IOT TEST SUITES PASSED SUCCESSFULLY!');
console.log('=============================================\n');
