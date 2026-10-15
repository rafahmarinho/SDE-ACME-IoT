import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppStorage } from '../../src/services/storage';
import { AuthService, isSupabaseConfigured } from '../../src/services/supabase';

export default function SettingsScreen() {
  const router = useRouter();
  const [user] = useState(AppStorage.getCurrentUser());
  const [notifyOnAlert, setNotifyOnAlert] = useState(true);
  const [notifyOnAutomation, setNotifyOnAutomation] = useState(true);
  const [dailyDigest, setDailyDigest] = useState(false);

  const handleLogout = async () => {
    await AuthService.signOut();
    router.replace('/(auth)/login');
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.heading}>Platform Settings & Security Posture</Text>
          <Text style={styles.subheading}>
            User credentials, notification policies, and verified SD Elements controls
          </Text>
        </View>
      </View>

      {/* User Profile Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <MaterialCommunityIcons name="account-circle-outline" size={20} color="#4f46e5" />
          <Text style={styles.cardTitle}>Operator Profile</Text>
        </View>

        <View style={styles.profileRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.fullName.charAt(0)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{user.fullName}</Text>
            <Text style={styles.profileEmail}>{user.email}</Text>
            <Text style={styles.profileRole}>Assigned Role: {user.role.toUpperCase()}</Text>
          </View>
        </View>
      </View>

      {/* Threat Modeling & SD Elements Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <MaterialCommunityIcons name="shield-check" size={20} color="#16a34a" />
          <Text style={styles.cardTitle}>SD Elements Security Threat Model</Text>
        </View>

        <Text style={styles.sdeDescription}>
          The ACME IoT platform has been assessed and cataloged against SD Elements Project #28.
          All 85 recommended countermeasures spanning architecture, PostgreSQL RLS, TLS encryption,
          mobile client hardening, input validation, and audit logging are traced.
        </Text>

        <View style={styles.complianceGrid}>
          <View style={styles.complianceBox}>
            <Text style={styles.complianceVal}>85</Text>
            <Text style={styles.complianceLabel}>Assessed Controls</Text>
          </View>
          <View style={styles.complianceBox}>
            <Text style={[styles.complianceVal, { color: '#16a34a' }]}>100%</Text>
            <Text style={styles.complianceLabel}>Survey Complete</Text>
          </View>
          <View style={styles.complianceBox}>
            <Text style={[styles.complianceVal, { color: '#4f46e5' }]}>PT-BR / EN</Text>
            <Text style={styles.complianceLabel}>Bilingual Notes</Text>
          </View>
        </View>
      </View>

      {/* Backend & Cloud Connectivity */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <MaterialCommunityIcons name="server-network" size={20} color="#4f46e5" />
          <Text style={styles.cardTitle}>Backend & Database Connectivity</Text>
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Supabase PostgreSQL Engine:</Text>
          <Text
            style={[
              styles.statusValue,
              isSupabaseConfigured ? { color: '#15803d' } : { color: '#64748b' },
            ]}
          >
            {isSupabaseConfigured ? 'Connected (Live RLS Cloud)' : 'Active (Local Offline Fallback Mode)'}
          </Text>
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Vercel Serverless REST API:</Text>
          <Text style={[styles.statusValue, { color: '#15803d' }]}>
            Configured (/api/devices, /api/health)
          </Text>
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Realtime Telemetry Channel:</Text>
          <Text style={[styles.statusValue, { color: '#15803d' }]}>
            WebSockets / Long-Polling Active
          </Text>
        </View>
      </View>

      {/* Notification Preferences */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <MaterialCommunityIcons name="bell-outline" size={20} color="#4f46e5" />
          <Text style={styles.cardTitle}>Push & Notification Dispatch</Text>
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <Text style={styles.switchLabel}>Critical Incident Alerts</Text>
            <Text style={styles.switchSub}>
              Immediate dispatch when high temp or battery emergency occurs
            </Text>
          </View>
          <Switch
            value={notifyOnAlert}
            onValueChange={setNotifyOnAlert}
            trackColor={{ false: '#cbd5e1', true: '#c7d2fe' }}
            thumbColor={notifyOnAlert ? '#4f46e5' : '#f8fafc'}
          />
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <Text style={styles.switchLabel}>Automation Execution Events</Text>
            <Text style={styles.switchSub}>
              Notify when an edge rule changes target device setpoints
            </Text>
          </View>
          <Switch
            value={notifyOnAutomation}
            onValueChange={setNotifyOnAutomation}
            trackColor={{ false: '#cbd5e1', true: '#c7d2fe' }}
            thumbColor={notifyOnAutomation ? '#4f46e5' : '#f8fafc'}
          />
        </View>
      </View>

      {/* Logout button */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <MaterialCommunityIcons name="logout" size={18} color="#dc2626" />
        <Text style={styles.logoutBtnText}>Sign Out of ACME IoT</Text>
      </TouchableOpacity>
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
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 18,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  profileName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  profileEmail: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  profileRole: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4f46e5',
    marginTop: 4,
  },
  sdeDescription: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 14,
  },
  complianceGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
  },
  complianceBox: {
    alignItems: 'center',
  },
  complianceVal: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  complianceLabel: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  statusLabel: {
    fontSize: 12,
    color: '#64748b',
  },
  statusValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  switchLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  switchSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fee2e2',
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 10,
    marginBottom: 30,
  },
  logoutBtnText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '700',
  },
});
