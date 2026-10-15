import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Device, Room } from '../types';

interface RoomVisualizer3DProps {
  room?: Room;
  devices: Device[];
  onSelectDevice?: (device: Device) => void;
}

export const RoomVisualizer3D: React.FC<RoomVisualizer3DProps> = ({
  room,
  devices,
  onSelectDevice,
}) => {
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

  const roomName = room ? room.name : 'Data Center Alpha (Room 204)';
  const roomType = room ? room.type.replace('_', ' ').toUpperCase() : 'SERVER ROOM';

  // Device positioning inside isometric 3D space
  const devicePositions: Record<string, { x: number; y: number; z: number }> = {
    thermostat: { x: 30, y: 110, z: 20 },
    temperature_sensor: { x: 90, y: 160, z: 45 },
    humidity_sensor: { x: 190, y: 150, z: 30 },
    occupancy_sensor: { x: 140, y: 70, z: 80 },
    smart_plug: { x: 230, y: 195, z: 10 },
  };

  const handleDeviceClick = (d: Device) => {
    setSelectedDevice(d);
    if (onSelectDevice) onSelectDevice(d);
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <View style={styles.badgeRow}>
            <Text style={styles.typeBadge}>{roomType}</Text>
            <Text style={styles.floorBadge}>Floor {room?.floor ?? 2}</Text>
          </View>
          <Text style={styles.title}>{roomName}</Text>
        </View>
        <View style={styles.infoPill}>
          <MaterialCommunityIcons name="cube-outline" size={16} color="#4f46e5" />
          <Text style={styles.infoPillText}>3D Digital Twin</Text>
        </View>
      </View>

      {/* 3D Isometric View Container */}
      <View style={styles.sceneContainer}>
        {/* Isometric 3D Floor Grid */}
        <View style={styles.isoFloor}>
          <View style={styles.floorTile1} />
          <View style={styles.floorTile2} />
          <View style={styles.floorTile3} />
          <View style={styles.floorGridOverlay} />
        </View>

        {/* Isometric Walls */}
        <View style={styles.backWallLeft} />
        <View style={styles.backWallRight} />

        {/* Render Devices in 3D Isometric Coordinates */}
        {devices.map((device, index) => {
          const defaultPos = devicePositions[device.type] || {
            x: 50 + (index % 4) * 60,
            y: 100 + Math.floor(index / 4) * 40,
            z: 20,
          };
          const isSelected = selectedDevice?.id === device.id;
          const isOnline = device.status === 'online';

          let iconName: any = 'chip';
          let glowColor = '#4f46e5';

          if (device.type === 'thermostat') {
            iconName = 'thermostat';
            glowColor = '#0284c7';
          } else if (device.type === 'smart_plug') {
            iconName = 'power-socket-us';
            glowColor = device.reportedState.power === 'on' ? '#10b981' : '#94a3b8';
          } else if (device.type === 'occupancy_sensor') {
            iconName = 'motion-sensor';
            glowColor = device.reportedState.occupied ? '#f59e0b' : '#64748b';
          } else if (device.type === 'temperature_sensor') {
            iconName = 'thermometer-alert';
            glowColor = '#ef4444';
          } else if (device.type === 'humidity_sensor') {
            iconName = 'water-percent';
            glowColor = '#06b6d4';
          }

          return (
            <TouchableOpacity
              key={device.id}
              style={[
                styles.deviceNode3D,
                {
                  left: defaultPos.x,
                  top: defaultPos.y,
                  transform: [{ translateY: -defaultPos.z }],
                },
                isSelected && styles.deviceNodeSelected,
              ]}
              onPress={() => handleDeviceClick(device)}
            >
              {/* Radar pulse for active sensors */}
              {isOnline && (
                <View
                  style={[
                    styles.radarPulse,
                    { borderColor: glowColor, backgroundColor: glowColor + '15' },
                  ]}
                />
              )}

              {/* 3D Isometric Cube Box */}
              <View style={[styles.cubeHead, { backgroundColor: glowColor }]}>
                <MaterialCommunityIcons name={iconName} size={16} color="#ffffff" />
              </View>

              {/* Device Floating Tag */}
              <View style={styles.deviceTag}>
                <Text style={styles.deviceTagTitle} numberOfLines={1}>
                  {device.code}
                </Text>
                <Text style={styles.deviceTagMetric}>
                  {device.type === 'thermostat'
                    ? `${device.reportedState.current_temp ?? 22}°C`
                    : device.type === 'smart_plug'
                    ? `${device.reportedState.power_watts ?? 0}W`
                    : device.type === 'occupancy_sensor'
                    ? device.reportedState.occupied ? 'OCCUPIED' : 'VACANT'
                    : device.type === 'humidity_sensor'
                    ? `${device.reportedState.humidity ?? 45}%`
                    : `${device.reportedState.current_temp ?? 24}°C`}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Selected device details footer */}
      <View style={styles.footerBar}>
        {selectedDevice ? (
          <View style={styles.selectionCard}>
            <View style={styles.selectionInfo}>
              <Text style={styles.selectionTitle}>{selectedDevice.name}</Text>
              <Text style={styles.selectionSub}>
                Code: {selectedDevice.code} • Status: {selectedDevice.status} • Battery: {selectedDevice.batteryLevel}%
              </Text>
            </View>
            <View style={styles.stateComparison}>
              <View style={styles.stateBadge}>
                <Text style={styles.stateLabel}>DESIRED</Text>
                <Text style={styles.stateVal}>
                  {selectedDevice.type === 'thermostat'
                    ? `${selectedDevice.desiredState.target_temp ?? 21}°C`
                    : selectedDevice.desiredState.power ?? 'N/A'}
                </Text>
              </View>
              <View style={[styles.stateBadge, styles.reportedBadge]}>
                <Text style={styles.stateLabel}>REPORTED</Text>
                <Text style={styles.stateVal}>
                  {selectedDevice.type === 'thermostat'
                    ? `${selectedDevice.reportedState.current_temp ?? 21.8}°C`
                    : selectedDevice.type === 'smart_plug'
                    ? `${selectedDevice.reportedState.power ?? 'off'} (${selectedDevice.reportedState.power_watts ?? 0}W)`
                    : selectedDevice.reportedState.occupied ? 'Present' : 'Empty'}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <Text style={styles.hintText}>
            💡 Tap any 3D node above to inspect desired vs reported telemetry state.
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  header: {
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 4,
  },
  typeBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4f46e5',
    backgroundColor: '#eef2ff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  floorBadge: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748b',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  infoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#eef2ff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  infoPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4f46e5',
  },
  sceneContainer: {
    height: 280,
    backgroundColor: '#0f172a',
    position: 'relative',
    overflow: 'hidden',
  },
  isoFloor: {
    position: 'absolute',
    left: '10%',
    right: '10%',
    bottom: 20,
    height: 180,
    backgroundColor: '#1e293b',
    transform: [{ perspective: 600 }, { rotateX: '60deg' }, { rotateZ: '-30deg' }],
    borderWidth: 2,
    borderColor: '#334155',
    shadowColor: '#4f46e5',
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  floorTile1: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '33%',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  floorTile2: {
    position: 'absolute',
    top: '33%',
    left: 0,
    right: 0,
    height: '33%',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  floorTile3: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '34%',
  },
  floorGridOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.15,
    borderWidth: 1,
    borderColor: '#6366f1',
  },
  backWallLeft: {
    position: 'absolute',
    left: 30,
    top: 40,
    width: 140,
    height: 140,
    backgroundColor: '#172554',
    opacity: 0.35,
    transform: [{ skewY: '20deg' }],
    borderRightWidth: 1,
    borderRightColor: '#3b82f6',
  },
  backWallRight: {
    position: 'absolute',
    right: 30,
    top: 40,
    width: 140,
    height: 140,
    backgroundColor: '#1e1b4b',
    opacity: 0.35,
    transform: [{ skewY: '-20deg' }],
    borderLeftWidth: 1,
    borderLeftColor: '#6366f1',
  },
  deviceNode3D: {
    position: 'absolute',
    alignItems: 'center',
    zIndex: 10,
  },
  deviceNodeSelected: {
    zIndex: 20,
  },
  radarPulse: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    top: -8,
  },
  cubeHead: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  deviceTag: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#475569',
    alignItems: 'center',
  },
  deviceTagTitle: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '700',
  },
  deviceTagMetric: {
    color: '#f8fafc',
    fontSize: 10,
    fontWeight: '700',
  },
  footerBar: {
    padding: 12,
    backgroundColor: '#f8fafc',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  selectionCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  selectionInfo: {
    flex: 1,
    minWidth: 180,
  },
  selectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  selectionSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  stateComparison: {
    flexDirection: 'row',
    gap: 8,
  },
  stateBadge: {
    backgroundColor: '#eef2ff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    alignItems: 'center',
  },
  reportedBadge: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  stateLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#475569',
  },
  stateVal: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 2,
  },
  hintText: {
    fontSize: 12,
    color: '#64748b',
    fontStyle: 'italic',
  },
});
