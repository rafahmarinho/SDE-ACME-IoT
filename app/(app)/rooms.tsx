import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppStorage } from '../../src/services/storage';
import { RoomVisualizer3D } from '../../src/components/RoomVisualizer3D';
import { Room, Building, Device } from '../../src/types';

export default function RoomsScreen() {
  const router = useRouter();
  const [activeOrgId, setActiveOrgId] = useState(AppStorage.getActiveOrgId());
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('all');
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);

  const loadData = () => {
    const orgId = AppStorage.getActiveOrgId();
    setActiveOrgId(orgId);
    const b = AppStorage.getBuildings().filter((x) => x.organizationId === orgId);
    setBuildings(b);

    const bIds = new Set(b.map((x) => x.id));
    const r = AppStorage.getRooms().filter((x) => bIds.has(x.buildingId));
    setRooms(r);

    const d = AppStorage.getDevices().filter((x) => x.organizationId === orgId);
    setDevices(d);

    if (r.length > 0 && !activeRoom) {
      setActiveRoom(r[0]);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredRooms = rooms.filter(
    (r) => selectedBuildingId === 'all' || r.buildingId === selectedBuildingId
  );

  const currentRoomDevices = activeRoom
    ? devices.filter((d) => d.roomId === activeRoom.id)
    : [];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.heading}>Rooms & 3D Spatial Twins</Text>
          <Text style={styles.subheading}>
            Select a room to visualize installed environmental sensors and smart controls in 3D
          </Text>
        </View>

        {/* Building filter pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillsRow}>
          <TouchableOpacity
            style={[styles.pill, selectedBuildingId === 'all' && styles.pillActive]}
            onPress={() => setSelectedBuildingId('all')}
          >
            <Text style={[styles.pillText, selectedBuildingId === 'all' && styles.pillTextActive]}>
              All Buildings ({rooms.length})
            </Text>
          </TouchableOpacity>
          {buildings.map((b) => (
            <TouchableOpacity
              key={b.id}
              style={[styles.pill, selectedBuildingId === b.id && styles.pillActive]}
              onPress={() => setSelectedBuildingId(b.id)}
            >
              <Text style={[styles.pillText, selectedBuildingId === b.id && styles.pillTextActive]}>
                {b.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* 3D Visualizer for the currently active room */}
      {activeRoom && (
        <RoomVisualizer3D
          room={activeRoom}
          devices={currentRoomDevices}
          onSelectDevice={(d) => {
            router.push({
              pathname: '/(app)/device-detail',
              params: { id: d.id },
            } as any);
          }}
        />
      )}

      {/* Rooms List */}
      <Text style={styles.sectionTitle}>Facilities Rooms Directory</Text>
      <View style={styles.roomGrid}>
        {filteredRooms.map((r) => {
          const isSelected = activeRoom?.id === r.id;
          const roomDevs = devices.filter((d) => d.roomId === r.id);
          const b = buildings.find((x) => x.id === r.buildingId);

          return (
            <TouchableOpacity
              key={r.id}
              style={[styles.roomCard, isSelected && styles.roomCardSelected]}
              onPress={() => setActiveRoom(r)}
            >
              <View style={styles.roomHeader}>
                <View>
                  <Text style={styles.roomName}>{r.name}</Text>
                  <Text style={styles.roomMeta}>
                    {b?.name} • Room #{r.roomNumber} • Floor {r.floor}
                  </Text>
                </View>
                <View style={styles.typeBadge}>
                  <Text style={styles.typeBadgeText}>{r.type.replace('_', ' ').toUpperCase()}</Text>
                </View>
              </View>

              <View style={styles.roomFooter}>
                <View style={styles.deviceCountRow}>
                  <MaterialCommunityIcons name="chip" size={14} color="#4f46e5" />
                  <Text style={styles.deviceCountText}>
                    {roomDevs.length} Devices Deployed
                  </Text>
                </View>
                <Text style={styles.twinActionText}>
                  {isSelected ? 'Viewing in 3D ▲' : 'Open 3D Twin ▼'}
                </Text>
              </View>
            </TouchableOpacity>
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
  topBar: {
    marginBottom: 20,
  },
  heading: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  subheading: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    marginBottom: 12,
  },
  pillsRow: {
    flexDirection: 'row',
  },
  pill: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 8,
  },
  pillActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  pillTextActive: {
    color: '#ffffff',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  roomGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  roomCard: {
    flex: 1,
    minWidth: 280,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
  },
  roomCardSelected: {
    borderColor: '#6366f1',
    backgroundColor: '#f5f3ff',
    borderWidth: 2,
  },
  roomHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  roomName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  roomMeta: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  typeBadge: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#475569',
  },
  roomFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 10,
  },
  deviceCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  deviceCountText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  twinActionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4f46e5',
  },
});
