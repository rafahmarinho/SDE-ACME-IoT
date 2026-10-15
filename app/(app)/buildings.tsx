import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppStorage } from '../../src/services/storage';
import { Building, Room, Device } from '../../src/types';

export default function BuildingsScreen() {
  const router = useRouter();
  const [activeOrgId, setActiveOrgId] = useState(AppStorage.getActiveOrgId());
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [search, setSearch] = useState('');

  const loadData = () => {
    const orgId = AppStorage.getActiveOrgId();
    setActiveOrgId(orgId);
    setBuildings(AppStorage.getBuildings().filter((b) => b.organizationId === orgId));
    setRooms(AppStorage.getRooms());
    setDevices(AppStorage.getDevices().filter((d) => d.organizationId === orgId));
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredBuildings = buildings.filter(
    (b) =>
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.code.toLowerCase().includes(search.toLowerCase()) ||
      b.address.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Top Header */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.heading}>Building Facilities</Text>
          <Text style={styles.subheading}>
            Campus structures, floor layouts and integrated sensor coverage
          </Text>
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <MaterialCommunityIcons name="magnify" size={18} color="#64748b" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search buildings..."
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      {/* Buildings Grid */}
      <View style={styles.grid}>
        {filteredBuildings.map((b) => {
          const buildingRooms = rooms.filter((r) => r.buildingId === b.id);
          const buildingDevices = devices.filter((d) => d.buildingId === b.id);
          const onlineCount = buildingDevices.filter((d) => d.status === 'online').length;

          return (
            <View key={b.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.iconWrap}>
                  <MaterialCommunityIcons name="office-building" size={24} color="#4f46e5" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.buildingName}>{b.name}</Text>
                  <Text style={styles.buildingCode}>Code: {b.code}</Text>
                </View>
                <View style={styles.floorsBadge}>
                  <Text style={styles.floorsText}>{b.totalFloors} Floors</Text>
                </View>
              </View>

              <View style={styles.addressRow}>
                <MaterialCommunityIcons name="map-marker-outline" size={14} color="#64748b" />
                <Text style={styles.addressText}>{b.address}</Text>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statBox}>
                  <Text style={styles.statVal}>{buildingRooms.length}</Text>
                  <Text style={styles.statLabel}>Monitored Rooms</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statVal}>{buildingDevices.length}</Text>
                  <Text style={styles.statLabel}>Deployed Devices</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={[styles.statVal, { color: '#15803d' }]}>
                    {onlineCount} / {buildingDevices.length}
                  </Text>
                  <Text style={styles.statLabel}>Online Status</Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => router.push('/(app)/rooms')}
              >
                <Text style={styles.actionBtnText}>Explore Rooms & 3D Twins</Text>
                <MaterialCommunityIcons name="arrow-right" size={16} color="#4f46e5" />
              </TouchableOpacity>
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
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    flexWrap: 'wrap',
    gap: 12,
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
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 10,
    width: 240,
    height: 38,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0f172a',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  card: {
    flex: 1,
    minWidth: 320,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#eef2ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buildingName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  buildingCode: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  floorsBadge: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  floorsText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
  },
  addressText: {
    fontSize: 12,
    color: '#64748b',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  statBox: {
    alignItems: 'center',
  },
  statVal: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  statLabel: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: '#eef2ff',
    borderRadius: 8,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4f46e5',
  },
});
