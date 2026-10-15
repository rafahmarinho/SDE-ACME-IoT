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
import { subscribeToSimulation } from '../../src/services/simulation';
import { DeviceCard } from '../../src/components/DeviceCard';
import { Device, DeviceType, DeviceStatus } from '../../src/types';

export default function DevicesScreen() {
  const router = useRouter();
  const [activeOrgId, setActiveOrgId] = useState(AppStorage.getActiveOrgId());
  const [devices, setDevices] = useState<Device[]>([]);
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  const loadData = () => {
    const orgId = AppStorage.getActiveOrgId();
    setActiveOrgId(orgId);
    setDevices(AppStorage.getDevices().filter((d) => d.organizationId === orgId));
  };

  useEffect(() => {
    loadData();
    return subscribeToSimulation(() => {
      loadData();
    });
  }, []);

  const deviceTypes: { id: string; label: string }[] = [
    { id: 'all', label: 'All Types' },
    { id: 'thermostat', label: 'Thermostats' },
    { id: 'smart_plug', label: 'Smart Plugs' },
    { id: 'temperature_sensor', label: 'Temp Sensors' },
    { id: 'humidity_sensor', label: 'Humidity' },
    { id: 'occupancy_sensor', label: 'Occupancy' },
  ];

  const statuses: { id: string; label: string }[] = [
    { id: 'all', label: 'All Status' },
    { id: 'online', label: 'Online' },
    { id: 'offline', label: 'Offline' },
    { id: 'warning', label: 'Warning' },
  ];

  const filteredDevices = devices.filter((d) => {
    const matchesSearch =
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.code.toLowerCase().includes(search.toLowerCase());
    const matchesType = selectedType === 'all' || d.type === selectedType;
    const matchesStatus = selectedStatus === 'all' || d.status === selectedStatus;
    return matchesSearch && matchesType && matchesStatus;
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Top Header */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.heading}>Device Directory & Controls</Text>
          <Text style={styles.subheading}>
            Manage environmental sensors, smart switches, and HVAC controllers ({devices.length} total)
          </Text>
        </View>

        <TouchableOpacity
          style={styles.enrollBtn}
          onPress={() => router.push('/(app)/device-enroll')}
        >
          <MaterialCommunityIcons name="qrcode-scan" size={16} color="#ffffff" />
          <Text style={styles.enrollBtnText}>Enroll New Device</Text>
        </TouchableOpacity>
      </View>

      {/* Filter and Search Bar */}
      <View style={styles.filterCard}>
        <View style={styles.searchRow}>
          <MaterialCommunityIcons name="magnify" size={20} color="#64748b" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by device code (e.g. HQ-TH-101) or name..."
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <MaterialCommunityIcons name="close-circle" size={18} color="#94a3b8" />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.chipsSection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
            <Text style={styles.chipGroupLabel}>Type:</Text>
            {deviceTypes.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[styles.filterChip, selectedType === t.id && styles.filterChipActive]}
                onPress={() => setSelectedType(t.id)}
              >
                <Text style={[styles.filterChipText, selectedType === t.id && styles.filterChipTextActive]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
            <Text style={styles.chipGroupLabel}>Status:</Text>
            {statuses.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={[styles.filterChip, selectedStatus === s.id && styles.filterChipActive]}
                onPress={() => setSelectedStatus(s.id)}
              >
                <Text style={[styles.filterChipText, selectedStatus === s.id && styles.filterChipTextActive]}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>

      {/* Devices List */}
      <View style={styles.listContainer}>
        {filteredDevices.length > 0 ? (
          filteredDevices.map((dev) => (
            <DeviceCard
              key={dev.id}
              device={dev}
              onPress={() => {
                router.push({
                  pathname: '/(app)/device-detail',
                  params: { id: dev.id },
                } as any);
              }}
              onRefresh={loadData}
            />
          ))
        ) : (
          <View style={styles.emptyCard}>
            <MaterialCommunityIcons name="chip" size={40} color="#cbd5e1" />
            <Text style={styles.emptyTitle}>No matching devices found</Text>
            <Text style={styles.emptySub}>
              Try adjusting your search query or status filter.
            </Text>
          </View>
        )}
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
    marginBottom: 16,
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
  enrollBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#4f46e5',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  enrollBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  filterCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 20,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 40,
    gap: 8,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0f172a',
  },
  chipsSection: {
    gap: 8,
  },
  chipsRow: {
    flexDirection: 'row',
  },
  chipGroupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    alignSelf: 'center',
    marginRight: 8,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    marginRight: 6,
  },
  filterChipActive: {
    backgroundColor: '#4f46e5',
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  filterChipTextActive: {
    color: '#ffffff',
  },
  listContainer: {
    gap: 4,
  },
  emptyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 40,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 12,
  },
  emptySub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
});
