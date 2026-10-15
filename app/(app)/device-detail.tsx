import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppStorage } from '../../src/services/storage';
import { SimulationEngine, subscribeToSimulation } from '../../src/services/simulation';
import { StatusBadge } from '../../src/components/StatusBadge';
import { Device, Building, Room } from '../../src/types';

export default function DeviceDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [device, setDevice] = useState<Device | null>(null);
  const [building, setBuilding] = useState<Building | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const isOffline = AppStorage.isOfflineMode();

  const loadDevice = () => {
    if (!id) return;
    const all = AppStorage.getDevices();
    const found = all.find((d) => d.id === id);
    if (found) {
      setDevice(found);
      const b = AppStorage.getBuildings().find((x) => x.id === found.buildingId);
      const r = AppStorage.getRooms().find((x) => x.id === found.roomId);
      setBuilding(b || null);
      setRoom(r || null);
    }
  };

  useEffect(() => {
    loadDevice();
    return subscribeToSimulation(() => {
      loadDevice();
    });
  }, [id]);

  if (!device) {
    return (
      <View style={styles.notFoundWrap}>
        <Text style={styles.notFoundText}>Device not found.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Return to Directory</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleAdjustTemp = (delta: number) => {
    if (isOffline) {
      setFeedback('Control commands cannot be sent in offline mode. Please reconnect.');
      return;
    }
    const current = device.desiredState.target_temp ?? 22.0;
    const next = parseFloat((current + delta).toFixed(1));
    SimulationEngine.updateDesiredState(device.id, { target_temp: next });
    setFeedback(`Target temperature command dispatched: ${next}°C`);
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleTogglePlug = () => {
    if (isOffline) {
      setFeedback('Control commands cannot be sent in offline mode. Please reconnect.');
      return;
    }
    const current = device.desiredState.power ?? 'on';
    const next = current === 'on' ? 'off' : 'on';
    SimulationEngine.updateDesiredState(device.id, { power: next });
    setFeedback(`Smart plug power state switched to ${next.toUpperCase()}`);
    setTimeout(() => setFeedback(null), 3000);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Back button */}
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <MaterialCommunityIcons name="arrow-left" size={18} color="#4f46e5" />
        <Text style={styles.backBtnText}>Back to Devices</Text>
      </TouchableOpacity>

      {/* Main Device Header Card */}
      <View style={styles.headerCard}>
        <View style={styles.headerTop}>
          <View style={styles.deviceIconBox}>
            <MaterialCommunityIcons
              name={
                device.type === 'thermostat'
                  ? 'thermostat'
                  : device.type === 'smart_plug'
                  ? 'power-socket-us'
                  : device.type === 'occupancy_sensor'
                  ? 'motion-sensor'
                  : device.type === 'humidity_sensor'
                  ? 'water-percent'
                  : 'thermometer'
              }
              size={32}
              color="#4f46e5"
            />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <Text style={styles.deviceName}>{device.name}</Text>
              <StatusBadge status={device.status} />
            </View>
            <Text style={styles.deviceCode}>
              Serial: {device.code} • Firmware: {device.firmwareVersion} • Type: {device.type.toUpperCase()}
            </Text>
            <Text style={styles.locationText}>
              Location: {building?.name || 'Building'} &gt; {room?.name || 'Room'} (Floor {room?.floor ?? 1})
            </Text>
          </View>
        </View>

        {/* Telemetry Vitals Bar */}
        <View style={styles.vitalsBar}>
          <View style={styles.vitalBox}>
            <MaterialCommunityIcons
              name="battery"
              size={20}
              color={device.batteryLevel <= 20 ? '#ef4444' : '#15803d'}
            />
            <Text style={styles.vitalVal}>{device.batteryLevel}%</Text>
            <Text style={styles.vitalLabel}>Battery</Text>
          </View>

          <View style={styles.vitalBox}>
            <MaterialCommunityIcons name="wifi" size={20} color="#6366f1" />
            <Text style={styles.vitalVal}>{device.rssi} dBm</Text>
            <Text style={styles.vitalLabel}>Signal RSSI</Text>
          </View>

          <View style={styles.vitalBox}>
            <MaterialCommunityIcons name="clock-check-outline" size={20} color="#0284c7" />
            <Text style={styles.vitalVal}>
              {new Date(device.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
            <Text style={styles.vitalLabel}>Last Heartbeat</Text>
          </View>
        </View>
      </View>

      {feedback && (
        <View style={styles.feedbackNotice}>
          <MaterialCommunityIcons name="information-outline" size={18} color="#4f46e5" />
          <Text style={styles.feedbackNoticeText}>{feedback}</Text>
        </View>
      )}

      {/* Desired State vs Device-Reported State Section */}
      <Text style={styles.sectionHeading}>State Reconciliation (Digital Twin)</Text>
      <View style={styles.stateSplit}>
        {/* Desired State (Cloud / User Target) */}
        <View style={styles.stateCard}>
          <View style={styles.stateCardHeader}>
            <MaterialCommunityIcons name="cloud-sync-outline" size={18} color="#4f46e5" />
            <Text style={styles.stateCardTitle}>Desired State (Cloud Target)</Text>
          </View>

          {device.type === 'thermostat' && (
            <View style={styles.controlBlock}>
              <Text style={styles.controlCaption}>Target Temperature</Text>
              <Text style={styles.heroMetric}>{device.desiredState.target_temp ?? 22.0}°C</Text>
              <Text style={styles.subCaption}>Mode: {device.desiredState.mode ?? 'cooling'}</Text>

              <View style={styles.tempStepper}>
                <TouchableOpacity
                  style={styles.stepperActionBtn}
                  onPress={() => handleAdjustTemp(-0.5)}
                  disabled={isOffline}
                >
                  <MaterialCommunityIcons name="minus" size={20} color="#4f46e5" />
                </TouchableOpacity>
                <Text style={styles.stepperDisplay}>{device.desiredState.target_temp ?? 22.0}°C</Text>
                <TouchableOpacity
                  style={styles.stepperActionBtn}
                  onPress={() => handleAdjustTemp(0.5)}
                  disabled={isOffline}
                >
                  <MaterialCommunityIcons name="plus" size={20} color="#4f46e5" />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {device.type === 'smart_plug' && (
            <View style={styles.controlBlock}>
              <Text style={styles.controlCaption}>Desired Relay Contact</Text>
              <Text
                style={[
                  styles.heroMetric,
                  device.desiredState.power === 'on' ? { color: '#15803d' } : { color: '#64748b' },
                ]}
              >
                {device.desiredState.power?.toUpperCase() ?? 'ON'}
              </Text>

              <TouchableOpacity
                style={[
                  styles.plugToggleBtn,
                  device.desiredState.power === 'on' ? styles.plugBtnOn : styles.plugBtnOff,
                ]}
                onPress={handleTogglePlug}
                disabled={isOffline}
              >
                <MaterialCommunityIcons
                  name="power"
                  size={18}
                  color={device.desiredState.power === 'on' ? '#ffffff' : '#475569'}
                />
                <Text
                  style={[
                    styles.plugBtnText,
                    device.desiredState.power === 'on' && { color: '#ffffff' },
                  ]}
                >
                  {device.desiredState.power === 'on' ? 'DISENGAGE POWER' : 'ENGAGE POWER'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {(device.type === 'occupancy_sensor' ||
            device.type === 'temperature_sensor' ||
            device.type === 'humidity_sensor') && (
            <View style={styles.controlBlock}>
              <Text style={styles.controlCaption}>Sensor Sampling Strategy</Text>
              <Text style={styles.heroMetric}>15s Cadence</Text>
              <Text style={styles.subCaption}>Adaptive edge filtering active</Text>
            </View>
          )}
        </View>

        {/* Reported State (Edge / Device Live Telemetry) */}
        <View style={[styles.stateCard, styles.reportedStateCard]}>
          <View style={styles.stateCardHeader}>
            <MaterialCommunityIcons name="broadcast" size={18} color="#0284c7" />
            <Text style={[styles.stateCardTitle, { color: '#0369a1' }]}>
              Device-Reported State (Physical Live)
            </Text>
          </View>

          {device.type === 'thermostat' && (
            <View style={styles.controlBlock}>
              <Text style={styles.controlCaption}>Current Ambient Sensor</Text>
              <Text style={[styles.heroMetric, { color: '#0369a1' }]}>
                {device.reportedState.current_temp ?? 22.0}°C
              </Text>
              <Text style={styles.subCaption}>
                Fan: {device.reportedState.fan_speed ?? 'auto'} • Mode: {device.reportedState.mode ?? 'cooling'}
              </Text>
            </View>
          )}

          {device.type === 'smart_plug' && (
            <View style={styles.controlBlock}>
              <Text style={styles.controlCaption}>Measured Load & Amperage</Text>
              <Text style={[styles.heroMetric, { color: '#15803d' }]}>
                {device.reportedState.power_watts ?? 0.0} W
              </Text>
              <Text style={styles.subCaption}>
                Line Voltage: {device.reportedState.voltage ?? 120.0}V • State: {device.reportedState.power?.toUpperCase() ?? 'OFF'}
              </Text>
            </View>
          )}

          {device.type === 'occupancy_sensor' && (
            <View style={styles.controlBlock}>
              <Text style={styles.controlCaption}>Infrared & Radar Status</Text>
              <Text
                style={[
                  styles.heroMetric,
                  device.reportedState.occupied ? { color: '#b45309' } : { color: '#64748b' },
                ]}
              >
                {device.reportedState.occupied ? 'OCCUPIED' : 'VACANT'}
              </Text>
              <Text style={styles.subCaption}>
                Motion Triggered: {device.reportedState.motion_detected_at ? new Date(device.reportedState.motion_detected_at).toLocaleTimeString() : 'None'}
              </Text>
            </View>
          )}

          {device.type === 'temperature_sensor' && (
            <View style={styles.controlBlock}>
              <Text style={styles.controlCaption}>Thermal Probe Measurement</Text>
              <Text style={[styles.heroMetric, { color: '#dc2626' }]}>
                {device.reportedState.current_temp ?? 22.5}°C
              </Text>
            </View>
          )}

          {device.type === 'humidity_sensor' && (
            <View style={styles.controlBlock}>
              <Text style={styles.controlCaption}>Capacitive RH Probe</Text>
              <Text style={[styles.heroMetric, { color: '#0284c7' }]}>
                {device.reportedState.humidity ?? 45.0}% RH
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Historical Telemetry Samples */}
      <Text style={[styles.sectionHeading, { marginTop: 24 }]}>Recent Telemetry Packets</Text>
      <View style={styles.historyCard}>
        {[1, 2, 3, 4].map((i) => {
          const pastTime = new Date(Date.now() - i * 15000).toLocaleTimeString();
          return (
            <View key={i} style={styles.historyRow}>
              <MaterialCommunityIcons name="radiobox-marked" size={14} color="#4f46e5" />
              <Text style={styles.historyTime}>{pastTime}</Text>
              <Text style={styles.historyPayload}>
                {device.type === 'thermostat'
                  ? `Ambient: ${(device.reportedState.current_temp ?? 22.0) - i * 0.1}°C, Setpoint: ${device.desiredState.target_temp}°C`
                  : device.type === 'smart_plug'
                  ? `Active Power: ${(device.reportedState.power_watts ?? 250) + i * 2.3}W, Voltage: 120.1V`
                  : device.type === 'occupancy_sensor'
                  ? `State: ${device.reportedState.occupied ? 'Occupied' : 'Vacant'}, Confidence: 99.4%`
                  : `Metric: ${device.reportedState.current_temp ?? device.reportedState.humidity}`}
              </Text>
              <Text style={styles.historyStatus}>ACK 200</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#f8fafc',
  },
  notFoundWrap: {
    padding: 40,
    alignItems: 'center',
  },
  notFoundText: {
    fontSize: 16,
    color: '#64748b',
    marginBottom: 12,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
  },
  backBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4f46e5',
  },
  headerCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 20,
    marginBottom: 16,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  deviceIconBox: {
    width: 60,
    height: 60,
    borderRadius: 14,
    backgroundColor: '#eef2ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  deviceName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    flex: 1,
    marginRight: 10,
  },
  deviceCode: {
    fontSize: 12,
    color: '#64748b',
  },
  locationText: {
    fontSize: 11,
    color: '#4f46e5',
    fontWeight: '600',
    marginTop: 4,
  },
  vitalsBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 14,
  },
  vitalBox: {
    alignItems: 'center',
  },
  vitalVal: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 2,
  },
  vitalLabel: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 1,
  },
  feedbackNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#eef2ff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  feedbackNoticeText: {
    fontSize: 12,
    color: '#4338ca',
    fontWeight: '600',
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  stateSplit: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  stateCard: {
    flex: 1,
    minWidth: 280,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 18,
  },
  reportedStateCard: {
    backgroundColor: '#f8fafc',
    borderColor: '#bae6fd',
  },
  stateCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  stateCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4f46e5',
  },
  controlBlock: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  controlCaption: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  heroMetric: {
    fontSize: 32,
    fontWeight: '900',
    color: '#0f172a',
    marginVertical: 6,
  },
  subCaption: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 16,
  },
  tempStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    overflow: 'hidden',
  },
  stepperActionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#f1f5f9',
  },
  stepperDisplay: {
    paddingHorizontal: 16,
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  plugToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  plugBtnOn: {
    backgroundColor: '#dc2626',
  },
  plugBtnOff: {
    backgroundColor: '#16a34a',
  },
  plugBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  historyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  historyTime: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: 'monospace',
  },
  historyPayload: {
    flex: 1,
    fontSize: 11,
    color: '#1e293b',
  },
  historyStatus: {
    fontSize: 10,
    fontWeight: '700',
    color: '#15803d',
    backgroundColor: '#dcfce7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
