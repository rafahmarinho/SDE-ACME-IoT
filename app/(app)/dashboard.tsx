import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppStorage } from '../../src/services/storage';
import { subscribeToSimulation } from '../../src/services/simulation';
import { RoomVisualizer3D } from '../../src/components/RoomVisualizer3D';
import { DeviceCard } from '../../src/components/DeviceCard';
import { Device, Room, Alert, EventLog } from '../../src/types';

export default function DashboardScreen() {
  const router = useRouter();
  const [activeOrgId, setActiveOrgId] = useState(AppStorage.getActiveOrgId());
  const [devices, setDevices] = useState<Device[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [events, setEvents] = useState<EventLog[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = () => {
    const orgId = AppStorage.getActiveOrgId();
    setActiveOrgId(orgId);

    const allDevices = AppStorage.getDevices().filter((d) => d.organizationId === orgId);
    const allRooms = AppStorage.getRooms();
    const allAlerts = AppStorage.getAlerts().filter(
      (a) => a.organizationId === orgId && a.status === 'active'
    );
    const allEvents = AppStorage.getEvents().filter((e) => e.organizationId === orgId);

    setDevices(allDevices);
    setRooms(allRooms);
    setAlerts(allAlerts);
    setEvents(allEvents.slice(0, 5));
  };

  useEffect(() => {
    loadData();
    return subscribeToSimulation(() => {
      loadData();
    });
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
    setTimeout(() => setRefreshing(false), 400);
  };

  // KPIs
  const totalCount = devices.length;
  const onlineCount = devices.filter((d) => d.status === 'online').length;
  const totalPowerWatts = devices
    .filter((d) => d.type === 'smart_plug' && d.reportedState.power === 'on')
    .reduce((sum, d) => sum + (d.reportedState.power_watts ?? 0), 0);

  // Pick first room with devices for 3D simulation twin
  const primaryRoom = rooms[1] || rooms[0];
  const primaryRoomDevices = devices.filter((d) => d.roomId === primaryRoom?.id);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Top Greeting & Quick stats */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.heading}>Facility Operational Dashboard</Text>
          <Text style={styles.subheading}>
            Real-time IoT telemetry, environmental monitoring and autonomous controls
          </Text>
        </View>
        <TouchableOpacity
          style={styles.enrollBtn}
          onPress={() => router.push('/(app)/device-enroll')}
        >
          <MaterialCommunityIcons name="qrcode-scan" size={16} color="#ffffff" />
          <Text style={styles.enrollBtnText}>Enroll Device</Text>
        </TouchableOpacity>
      </View>

      {/* KPI Cards Grid */}
      <View style={styles.kpiGrid}>
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIconWrap, { backgroundColor: '#eef2ff' }]}>
            <MaterialCommunityIcons name="chip" size={22} color="#4f46e5" />
          </View>
          <View>
            <Text style={styles.kpiValue}>{totalCount}</Text>
            <Text style={styles.kpiLabel}>Total Devices</Text>
          </View>
        </View>

        <View style={styles.kpiCard}>
          <View style={[styles.kpiIconWrap, { backgroundColor: '#dcfce7' }]}>
            <MaterialCommunityIcons name="check-circle-outline" size={22} color="#15803d" />
          </View>
          <View>
            <Text style={styles.kpiValue}>
              {onlineCount} <Text style={styles.kpiSub}>/ {totalCount}</Text>
            </Text>
            <Text style={styles.kpiLabel}>Online Devices</Text>
          </View>
        </View>

        <View style={styles.kpiCard}>
          <View style={[styles.kpiIconWrap, { backgroundColor: '#fee2e2' }]}>
            <MaterialCommunityIcons name="bell-alert-outline" size={22} color="#b91c1c" />
          </View>
          <View>
            <Text style={[styles.kpiValue, alerts.length > 0 && { color: '#b91c1c' }]}>
              {alerts.length}
            </Text>
            <Text style={styles.kpiLabel}>Active Alerts</Text>
          </View>
        </View>

        <View style={styles.kpiCard}>
          <View style={[styles.kpiIconWrap, { backgroundColor: '#fef3c7' }]}>
            <MaterialCommunityIcons name="lightning-bolt-outline" size={22} color="#b45309" />
          </View>
          <View>
            <Text style={styles.kpiValue}>{totalPowerWatts.toFixed(0)} W</Text>
            <Text style={styles.kpiLabel}>Active Load</Text>
          </View>
        </View>
      </View>

      {/* 3D Digital Twin Visualizer */}
      <RoomVisualizer3D
        room={primaryRoom}
        devices={primaryRoomDevices}
        onSelectDevice={(d) => {
          router.push({
            pathname: '/(app)/device-detail',
            params: { id: d.id },
          } as any);
        }}
      />

      {/* Split section: Devices feed + Live events stream */}
      <View style={styles.contentColumns}>
        {/* Left Column: Device Cards with live desired vs reported state */}
        <View style={styles.columnLeft}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Active Devices & Controls</Text>
            <TouchableOpacity onPress={() => router.push('/(app)/devices')}>
              <Text style={styles.viewAllLink}>View All ({devices.length}) →</Text>
            </TouchableOpacity>
          </View>

          {devices.slice(0, 4).map((dev) => (
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
          ))}
        </View>

        {/* Right Column: Live Stream & Critical Alerts */}
        <View style={styles.columnRight}>
          {/* Active alerts box */}
          {alerts.length > 0 && (
            <View style={styles.alertsCard}>
              <View style={styles.alertsHeader}>
                <MaterialCommunityIcons name="alert-circle" size={18} color="#b91c1c" />
                <Text style={styles.alertsTitle}>Requires Attention ({alerts.length})</Text>
              </View>
              {alerts.map((al) => (
                <View key={al.id} style={styles.alertItem}>
                  <Text style={styles.alertItemTitle}>{al.title}</Text>
                  <Text style={styles.alertItemMsg}>{al.message}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Real-time audit events */}
          <View style={styles.eventsCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Live Activity Stream</Text>
              <TouchableOpacity onPress={() => router.push('/(app)/events')}>
                <Text style={styles.viewAllLink}>History →</Text>
              </TouchableOpacity>
            </View>

            {events.map((ev) => (
              <View key={ev.id} style={styles.eventRow}>
                <View style={styles.eventBullet} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.eventType}>{ev.eventType.replace('_', ' ').toUpperCase()}</Text>
                  <Text style={styles.eventPayload} numberOfLines={2}>
                    {JSON.stringify(ev.payload)}
                  </Text>
                  <Text style={styles.eventTime}>
                    {new Date(ev.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
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
    letterSpacing: -0.4,
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
    shadowColor: '#4f46e5',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  enrollBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  kpiCard: {
    flex: 1,
    minWidth: 150,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  kpiIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  kpiValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  kpiSub: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748b',
  },
  kpiLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    marginTop: 2,
  },
  contentColumns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
  },
  columnLeft: {
    flex: 2,
    minWidth: 320,
  },
  columnRight: {
    flex: 1,
    minWidth: 280,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  viewAllLink: {
    fontSize: 12,
    color: '#4f46e5',
    fontWeight: '600',
  },
  alertsCard: {
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  alertsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  alertsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#b91c1c',
  },
  alertItem: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#ef4444',
  },
  alertItemTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  alertItemMsg: {
    fontSize: 11,
    color: '#475569',
    marginTop: 2,
  },
  eventsCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  eventBullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4f46e5',
    marginTop: 4,
  },
  eventType: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4f46e5',
  },
  eventPayload: {
    fontSize: 11,
    color: '#334155',
    marginTop: 2,
  },
  eventTime: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 2,
  },
});
