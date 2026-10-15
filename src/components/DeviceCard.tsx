import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Device } from '../types';
import { StatusBadge } from './StatusBadge';
import { SimulationEngine } from '../services/simulation';
import { AppStorage } from '../services/storage';

interface DeviceCardProps {
  device: Device;
  onPress?: () => void;
  onRefresh?: () => void;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({ device, onPress, onRefresh }) => {
  const isOfflineMode = AppStorage.isOfflineMode();
  const isDeviceOffline = device.status === 'offline';
  const disableControls = isOfflineMode || isDeviceOffline;

  // Temperature control handlers
  const handleTempDelta = (delta: number) => {
    if (disableControls) return;
    const current = device.desiredState.target_temp ?? 22.0;
    const next = parseFloat((current + delta).toFixed(1));
    SimulationEngine.updateDesiredState(device.id, { target_temp: next });
    if (onRefresh) onRefresh();
  };

  // Plug control handler
  const handleTogglePlug = () => {
    if (disableControls) return;
    const current = device.desiredState.power ?? 'on';
    const next = current === 'on' ? 'off' : 'on';
    SimulationEngine.updateDesiredState(device.id, { power: next });
    if (onRefresh) onRefresh();
  };

  let iconName: any = 'chip';
  if (device.type === 'thermostat') iconName = 'thermostat';
  else if (device.type === 'smart_plug') iconName = 'power-socket-us';
  else if (device.type === 'occupancy_sensor') iconName = 'motion-sensor';
  else if (device.type === 'temperature_sensor') iconName = 'thermometer';
  else if (device.type === 'humidity_sensor') iconName = 'water-percent';

  return (
    <View style={styles.card}>
      <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={styles.mainTouchable}>
        {/* Header row */}
        <View style={styles.cardHeader}>
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons name={iconName} size={22} color="#4f46e5" />
          </View>
          <View style={styles.titleArea}>
            <Text style={styles.name} numberOfLines={1}>{device.name}</Text>
            <Text style={styles.code}>{device.code} • {device.firmwareVersion}</Text>
          </View>
          <StatusBadge status={device.status} />
        </View>

        {/* Vital stats row (Battery, RSSI) */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <MaterialCommunityIcons
              name={
                device.batteryLevel > 70
                  ? 'battery'
                  : device.batteryLevel > 20
                  ? 'battery-medium'
                  : 'battery-alert'
              }
              size={14}
              color={device.batteryLevel <= 20 ? '#ef4444' : '#64748b'}
            />
            <Text style={[styles.statVal, device.batteryLevel <= 20 && { color: '#ef4444' }]}>
              {device.batteryLevel}%
            </Text>
          </View>

          <View style={styles.statItem}>
            <MaterialCommunityIcons name="wifi" size={14} color="#64748b" />
            <Text style={styles.statVal}>{device.rssi} dBm</Text>
          </View>

          <View style={styles.statItem}>
            <MaterialCommunityIcons name="clock-outline" size={14} color="#64748b" />
            <Text style={styles.statVal}>
              {new Date(device.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </Text>
          </View>
        </View>

        {/* Desired vs Reported state container */}
        <View style={styles.stateComparisonContainer}>
          <View style={styles.stateBox}>
            <Text style={styles.stateHeading}>DESIRED STATE</Text>
            {device.type === 'thermostat' && (
              <Text style={styles.stateData}>
                {device.desiredState.target_temp ?? 22.0}°C ({device.desiredState.mode ?? 'cooling'})
              </Text>
            )}
            {device.type === 'smart_plug' && (
              <Text style={styles.stateData}>Power: {device.desiredState.power?.toUpperCase() ?? 'ON'}</Text>
            )}
            {(device.type === 'temperature_sensor' || device.type === 'humidity_sensor') && (
              <Text style={styles.stateData}>Rate: {device.desiredState.sampling_rate ?? 10}s</Text>
            )}
            {device.type === 'occupancy_sensor' && (
              <Text style={styles.stateData}>Sens: {device.desiredState.sensitivity?.toUpperCase() ?? 'HIGH'}</Text>
            )}
          </View>

          <View style={styles.stateDivider} />

          <View style={[styles.stateBox, styles.reportedBox]}>
            <Text style={styles.stateHeading}>REPORTED (LIVE)</Text>
            {device.type === 'thermostat' && (
              <Text style={[styles.stateData, { color: '#0369a1' }]}>
                {device.reportedState.current_temp ?? 22.0}°C (Fan: {device.reportedState.fan_speed ?? 'auto'})
              </Text>
            )}
            {device.type === 'smart_plug' && (
              <Text style={[styles.stateData, device.reportedState.power === 'on' ? { color: '#15803d' } : { color: '#64748b' }]}>
                {device.reportedState.power?.toUpperCase() ?? 'OFF'} ({device.reportedState.power_watts ?? 0} W)
              </Text>
            )}
            {device.type === 'occupancy_sensor' && (
              <Text style={[styles.stateData, device.reportedState.occupied ? { color: '#b45309' } : { color: '#64748b' }]}>
                {device.reportedState.occupied ? 'Occupied' : 'Vacant'}
              </Text>
            )}
            {device.type === 'temperature_sensor' && (
              <Text style={[styles.stateData, { color: '#0f172a' }]}>
                {device.reportedState.current_temp ?? 22.5}°C
              </Text>
            )}
            {device.type === 'humidity_sensor' && (
              <Text style={[styles.stateData, { color: '#0f172a' }]}>
                {device.reportedState.humidity ?? 45.0}% RH
              </Text>
            )}
          </View>
        </View>
      </TouchableOpacity>

      {/* Quick Action Controls */}
      <View style={styles.actionToolbar}>
        {device.type === 'thermostat' && (
          <View style={styles.controlRow}>
            <Text style={styles.controlLabel}>Target Temp:</Text>
            <View style={styles.stepperWrap}>
              <TouchableOpacity
                disabled={disableControls}
                style={[styles.stepperBtn, disableControls && styles.disabledBtn]}
                onPress={() => handleTempDelta(-0.5)}
              >
                <MaterialCommunityIcons name="minus" size={16} color={disableControls ? '#94a3b8' : '#4f46e5'} />
              </TouchableOpacity>
              <Text style={styles.stepperValue}>{device.desiredState.target_temp ?? 22}°C</Text>
              <TouchableOpacity
                disabled={disableControls}
                style={[styles.stepperBtn, disableControls && styles.disabledBtn]}
                onPress={() => handleTempDelta(0.5)}
              >
                <MaterialCommunityIcons name="plus" size={16} color={disableControls ? '#94a3b8' : '#4f46e5'} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {device.type === 'smart_plug' && (
          <View style={styles.controlRow}>
            <Text style={styles.controlLabel}>Power Control:</Text>
            <TouchableOpacity
              disabled={disableControls}
              style={[
                styles.powerToggleBtn,
                device.desiredState.power === 'on' ? styles.powerOn : styles.powerOff,
                disableControls && styles.disabledBtn,
              ]}
              onPress={handleTogglePlug}
            >
              <MaterialCommunityIcons
                name="power"
                size={16}
                color={device.desiredState.power === 'on' ? '#ffffff' : '#475569'}
              />
              <Text
                style={[
                  styles.powerToggleText,
                  device.desiredState.power === 'on' && { color: '#ffffff' },
                ]}
              >
                {device.desiredState.power === 'on' ? 'TURN OFF' : 'TURN ON'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {(device.type === 'occupancy_sensor' ||
          device.type === 'temperature_sensor' ||
          device.type === 'humidity_sensor') && (
          <View style={styles.controlRow}>
            <Text style={styles.controlLabel}>Telemetry Ingest:</Text>
            <Text style={styles.telemetryTag}>Direct Sensor Feed Active</Text>
          </View>
        )}

        <TouchableOpacity onPress={onPress} style={styles.detailsBtn}>
          <Text style={styles.detailsBtnText}>Details</Text>
          <MaterialCommunityIcons name="chevron-right" size={16} color="#4f46e5" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  mainTouchable: {
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#eef2ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  titleArea: {
    flex: 1,
    marginRight: 8,
  },
  name: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  code: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statVal: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
  },
  stateComparisonContainer: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  stateBox: {
    flex: 1,
  },
  reportedBox: {
    paddingLeft: 10,
  },
  stateDivider: {
    width: 1,
    backgroundColor: '#e2e8f0',
  },
  stateHeading: {
    fontSize: 9,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  stateData: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  actionToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    flexWrap: 'wrap',
    gap: 8,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  controlLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  stepperWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    overflow: 'hidden',
  },
  stepperBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#f1f5f9',
  },
  disabledBtn: {
    opacity: 0.5,
  },
  stepperValue: {
    paddingHorizontal: 8,
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  powerToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  powerOn: {
    backgroundColor: '#10b981',
  },
  powerOff: {
    backgroundColor: '#e2e8f0',
  },
  powerToggleText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  telemetryTag: {
    fontSize: 10,
    color: '#059669',
    fontWeight: '600',
  },
  detailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  detailsBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4f46e5',
  },
});
