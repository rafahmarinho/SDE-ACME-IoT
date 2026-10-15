// ACME IoT Simulation Engine
// Simulates live telemetry, fluctuations, battery drain, offline/reconnection events,
// firmware OTA multi-stage rollouts, and evaluates active automations.
import {
  Device,
  SimulationScenario,
  Automation,
  Alert,
  EventLog,
  FirmwareRollout,
} from '../types';
import { AppStorage } from './storage';
import { logAuditEvent } from './security';

type SimulationListener = () => void;
const listeners = new Set<SimulationListener>();

export function subscribeToSimulation(listener: SimulationListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error('Simulation listener error:', e);
    }
  });
}

export class SimulationEngine {
  private static timer: any = null;
  private static isRunning = false;
  private static tickIntervalMs = 4000;

  static start(intervalMs = 4000): void {
    this.tickIntervalMs = intervalMs;
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      // Pause updates if offline mode is set
      if (AppStorage.isOfflineMode()) {
        return;
      }
      this.advanceTick();
    }, this.tickIntervalMs);
  }

  static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  static isActive(): boolean {
    return this.isRunning;
  }

  static setScenario(scenario: SimulationScenario): void {
    AppStorage.setScenario(scenario);
    logAuditEvent('scenario_changed', { scenario });
    this.advanceTick(true);
  }

  // Advance simulation by 1 tick
  static advanceTick(forceScenarioEffect = false): {
    updatedDevices: number;
    triggeredAutomations: number;
    newAlerts: number;
  } {
    const scenario = AppStorage.getScenario();
    const devices = AppStorage.getDevices();
    const automations = AppStorage.getAutomations();
    const alerts = AppStorage.getAlerts();
    const now = new Date().toISOString();

    let automationsTriggered = 0;
    let alertsCreated = 0;

    // 1. Process each device telemetry according to scenario
    const updatedDevicesList = devices.map((dev) => {
      const copy: Device = JSON.parse(JSON.stringify(dev));
      copy.lastSeenAt = now;

      // Apply scenario specifics
      if (scenario === 'battery_drain') {
        if (copy.batteryLevel > 0 && Math.random() > 0.4) {
          copy.batteryLevel = Math.max(0, copy.batteryLevel - Math.floor(Math.random() * 3 + 1));
          if (copy.batteryLevel <= 15 && copy.status !== 'warning') {
            copy.status = 'warning';
            this.createAlert(copy, 'warning', `Low Battery Warning (${copy.batteryLevel}%)`, `Battery level critical on device ${copy.code}.`);
            alertsCreated++;
          }
        }
      } else if (scenario === 'network_jitter') {
        // Random disconnection and reconnection
        if (Math.random() > 0.8) {
          copy.status = copy.status === 'online' ? 'offline' : 'online';
          copy.rssi = copy.status === 'online' ? -55 - Math.floor(Math.random() * 25) : -95;
          if (copy.status === 'offline') {
            this.createAlert(copy, 'warning', 'Device Connectivity Lost', `Connection heartbeat timed out for ${copy.name} (${copy.code}).`);
            alertsCreated++;
          }
        }
      } else if (scenario === 'heatwave') {
        if (copy.type === 'thermostat' || copy.type === 'temperature_sensor') {
          const current = copy.reportedState.current_temp ?? 22.0;
          copy.reportedState.current_temp = parseFloat((current + (Math.random() * 0.8 + 0.2)).toFixed(1));
          if (copy.reportedState.current_temp > 30.0) {
            this.createAlert(copy, 'critical', 'High Temperature Breach', `Ambient temperature reached ${copy.reportedState.current_temp}°C on ${copy.name}.`);
            alertsCreated++;
          }
        }
      }

      // Normal operations: gradual convergence towards desired state and slight sensor noise
      if (copy.status === 'online') {
        if (copy.type === 'thermostat') {
          const target = copy.desiredState.target_temp ?? 22.0;
          const current = copy.reportedState.current_temp ?? target;
          const diff = target - current;
          // Step towards target by 0.2
          if (Math.abs(diff) > 0.1) {
            copy.reportedState.current_temp = parseFloat((current + Math.sign(diff) * 0.2).toFixed(1));
          } else {
            // Slight ambient fluctuation +-0.1
            const fluctuation = (Math.random() - 0.5) * 0.2;
            copy.reportedState.current_temp = parseFloat((target + fluctuation).toFixed(1));
          }
          copy.reportedState.target_temp = target;
          copy.reportedState.mode = copy.desiredState.mode ?? 'cooling';
        } else if (copy.type === 'smart_plug') {
          const desiredPower = copy.desiredState.power ?? 'on';
          copy.reportedState.power = desiredPower;
          if (desiredPower === 'on') {
            // Wattage fluctuation
            const baseWatt = copy.reportedState.power_watts ?? 250.0;
            const wattDelta = (Math.random() - 0.5) * 20.0;
            copy.reportedState.power_watts = Math.max(10, parseFloat((baseWatt + wattDelta).toFixed(1)));
            copy.reportedState.voltage = parseFloat((120.0 + (Math.random() - 0.5) * 2.0).toFixed(1));
          } else {
            copy.reportedState.power_watts = 0.0;
          }
        } else if (copy.type === 'occupancy_sensor') {
          // Flip motion state intermittently
          if (Math.random() > 0.85) {
            copy.reportedState.occupied = !copy.reportedState.occupied;
            if (copy.reportedState.occupied) {
              copy.reportedState.motion_detected_at = now;
            }
          }
        } else if (copy.type === 'temperature_sensor') {
          const current = copy.reportedState.current_temp ?? 22.5;
          const drift = (Math.random() - 0.5) * 0.3;
          copy.reportedState.current_temp = parseFloat((current + drift).toFixed(1));
        } else if (copy.type === 'humidity_sensor') {
          const current = copy.reportedState.humidity ?? 45.0;
          const drift = (Math.random() - 0.5) * 0.8;
          copy.reportedState.humidity = parseFloat((Math.min(95, Math.max(20, current + drift))).toFixed(1));
        }
      }

      return copy;
    });

    AppStorage.setDevices(updatedDevicesList);

    // 2. Evaluate automations
    const activeOrgId = AppStorage.getActiveOrgId();
    const updatedAutomations = automations.map((auto) => {
      if (!auto.enabled) return auto;

      const condition = auto.triggerCondition;
      const srcDevice = updatedDevicesList.find((d) => d.id === condition.deviceId);
      if (!srcDevice || srcDevice.status !== 'online') return auto;

      let metricVal: any;
      if (condition.metric in srcDevice.reportedState) {
        metricVal = (srcDevice.reportedState as any)[condition.metric];
      }

      if (metricVal === undefined) return auto;

      let triggered = false;
      if (condition.operator === '>=' && Number(metricVal) >= Number(condition.value)) triggered = true;
      else if (condition.operator === '<=' && Number(metricVal) <= Number(condition.value)) triggered = true;
      else if (condition.operator === '>' && Number(metricVal) > Number(condition.value)) triggered = true;
      else if (condition.operator === '<' && Number(metricVal) < Number(condition.value)) triggered = true;
      else if (condition.operator === '==' && metricVal === condition.value) triggered = true;
      else if (condition.operator === '!=' && metricVal !== condition.value) triggered = true;

      if (triggered) {
        // Execute action on target device
        const target = updatedDevicesList.find((d) => d.id === auto.action.targetDeviceId);
        if (target) {
          if (auto.action.command === 'set_target_temp') {
            target.desiredState.target_temp = Number(auto.action.value);
          } else if (auto.action.command === 'set_power') {
            target.desiredState.power = auto.action.value as 'on' | 'off';
          }

          automationsTriggered++;
          AppStorage.addEvent({
            organizationId: auto.organizationId,
            deviceId: target.id,
            eventType: 'state_change',
            actorRole: 'automation_engine',
            payload: {
              automationId: auto.id,
              automationName: auto.name,
              command: auto.action.command,
              value: auto.action.value,
            },
          });
        }

        return {
          ...auto,
          lastExecutedAt: now,
          executionCount: auto.executionCount + 1,
        };
      }

      return auto;
    });

    AppStorage.setAutomations(updatedAutomations);

    // 3. Progress firmware rollout if active
    this.progressFirmwareRollout();

    notifyListeners();

    return {
      updatedDevices: updatedDevicesList.length,
      triggeredAutomations: automationsTriggered,
      newAlerts: alertsCreated,
    };
  }

  // Helper to create an alert if not duplicate
  private static createAlert(device: Device, severity: 'critical' | 'warning' | 'info', title: string, message: string): void {
    const alerts = AppStorage.getAlerts();
    const existing = alerts.find((a) => a.deviceId === device.id && a.title === title && a.status === 'active');
    if (existing) return;

    const newAlert: Alert = {
      id: 'al_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      organizationId: device.organizationId,
      deviceId: device.id,
      severity,
      title,
      message,
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    AppStorage.setAlerts([newAlert, ...alerts]);
    AppStorage.addEvent({
      organizationId: device.organizationId,
      deviceId: device.id,
      eventType: 'alert_triggered',
      actorRole: 'system',
      payload: { severity, title, message },
    });
  }

  // Simulate OTA Firmware update progress and rollback
  static progressFirmwareRollout(): void {
    const rollouts = AppStorage.getFirmwareRollouts();
    let changed = false;

    const updated = rollouts.map((ro) => {
      if (ro.status !== 'in_progress') return ro;
      changed = true;
      const nextProgress = Math.min(100, ro.progressPercent + 10);
      const isComplete = nextProgress >= 100;

      // Update devices targeted
      const devices = AppStorage.getDevices();
      const targetDevs = devices.filter((d) => d.type === ro.targetType);
      const updatedCount = Math.floor((nextProgress / 100) * targetDevs.length);

      return {
        ...ro,
        progressPercent: nextProgress,
        updatedDevices: updatedCount,
        status: isComplete ? ('completed' as const) : ('in_progress' as const),
      };
    });

    if (changed) {
      AppStorage.setFirmwareRollouts(updated);
    }
  }

  // Trigger manual OTA Rollback simulation
  static rollbackRollout(rolloutId: string): void {
    const rollouts = AppStorage.getFirmwareRollouts();
    const target = rollouts.find((r) => r.id === rolloutId);
    if (!target) return;

    target.status = 'rolled_back';
    target.progressPercent = 0;
    AppStorage.setFirmwareRollouts(rollouts);

    AppStorage.addEvent({
      organizationId: AppStorage.getActiveOrgId(),
      eventType: 'firmware_updated',
      actorRole: 'administrator',
      payload: {
        action: 'rollback_firmware',
        rolloutId,
        reason: 'Automated rollback triggered due to telemetry anomaly',
      },
    });

    notifyListeners();
  }

  // Device control: update desired state (requires online connection)
  static updateDesiredState(deviceId: string, updates: Partial<Device['desiredState']>): { success: boolean; error?: string } {
    if (AppStorage.isOfflineMode()) {
      return { success: false, error: 'Cannot control device while in offline mode. Please reconnect.' };
    }

    const devices = AppStorage.getDevices();
    const dev = devices.find((d) => d.id === deviceId);
    if (!dev) return { success: false, error: 'Device not found' };

    dev.desiredState = { ...dev.desiredState, ...updates };
    AppStorage.setDevices(devices);

    AppStorage.addEvent({
      organizationId: dev.organizationId,
      deviceId: dev.id,
      eventType: 'state_change',
      actorRole: AppStorage.getCurrentUser().role,
      payload: updates,
    });

    notifyListeners();
    return { success: true };
  }

  // Device enrollment (QR code or manual code)
  static enrollDevice(data: {
    name: string;
    code: string;
    type: Device['type'];
    buildingId: string;
    roomId: string;
    organizationId: string;
  }): { success: boolean; device?: Device; error?: string } {
    const devices = AppStorage.getDevices();
    if (devices.some((d) => d.code.toLowerCase() === data.code.toLowerCase())) {
      return { success: false, error: `Device code '${data.code}' is already enrolled.` };
    }

    const newDevice: Device = {
      id: 'd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
      organizationId: data.organizationId,
      buildingId: data.buildingId,
      roomId: data.roomId,
      name: data.name,
      code: data.code.toUpperCase(),
      type: data.type,
      status: 'online',
      batteryLevel: 100,
      rssi: -54,
      firmwareVersion: 'v1.0.0',
      desiredState: data.type === 'thermostat' ? { target_temp: 22.0, mode: 'cooling' } : data.type === 'smart_plug' ? { power: 'on' } : {},
      reportedState: data.type === 'thermostat' ? { current_temp: 22.0, target_temp: 22.0, mode: 'cooling' } : data.type === 'smart_plug' ? { power: 'on', power_watts: 50.0 } : {},
      lastSeenAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    devices.push(newDevice);
    AppStorage.setDevices(devices);

    AppStorage.addEvent({
      organizationId: data.organizationId,
      deviceId: newDevice.id,
      eventType: 'enrollment',
      actorRole: AppStorage.getCurrentUser().role,
      payload: { code: newDevice.code, name: newDevice.name, type: newDevice.type },
    });

    notifyListeners();
    return { success: true, device: newDevice };
  }
}
