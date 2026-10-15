import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppStorage } from '../../src/services/storage';
import { SimulationEngine, subscribeToSimulation } from '../../src/services/simulation';
import { StatusBadge } from '../../src/components/StatusBadge';
import { FirmwarePackage, FirmwareRollout, Device } from '../../src/types';

export default function FirmwareScreen() {
  const [packages, setPackages] = useState<FirmwarePackage[]>([]);
  const [rollouts, setRollouts] = useState<FirmwareRollout[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);

  const loadData = () => {
    setPackages(AppStorage.getFirmwarePackages());
    setRollouts(AppStorage.getFirmwareRollouts());
    setDevices(AppStorage.getDevices());
  };

  useEffect(() => {
    loadData();
    return subscribeToSimulation(() => {
      loadData();
    });
  }, []);

  const handleStartRollout = (pkg: FirmwarePackage) => {
    const targetDevs = devices.filter((d) => d.type === pkg.deviceType);
    const newRollout: FirmwareRollout = {
      id: 'ro_' + Date.now(),
      firmwareId: pkg.id,
      targetType: pkg.deviceType,
      totalDevices: targetDevs.length,
      updatedDevices: 0,
      failedDevices: 0,
      status: 'in_progress',
      progressPercent: 10,
      createdAt: new Date().toISOString(),
    };

    const current = AppStorage.getFirmwareRollouts();
    AppStorage.setFirmwareRollouts([newRollout, ...current]);
    loadData();
  };

  const handleRollback = (rolloutId: string) => {
    SimulationEngine.rollbackRollout(rolloutId);
    loadData();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.heading}>Firmware OTA & Fleet Lifecycle</Text>
          <Text style={styles.subheading}>
            Cryptographically signed binary packages with staged OTA rollout and automated rollback
          </Text>
        </View>
      </View>

      {/* Active OTA Rollouts Section */}
      <Text style={styles.sectionTitle}>Active Rollout Campaigns</Text>
      <View style={styles.rolloutsList}>
        {rollouts.map((ro) => {
          const pkg = packages.find((p) => p.id === ro.firmwareId);
          const isRollback = ro.status === 'rolled_back';
          const isComplete = ro.status === 'completed';

          return (
            <View key={ro.id} style={styles.rolloutCard}>
              <View style={styles.rolloutHeader}>
                <View>
                  <Text style={styles.rolloutTitle}>
                    {ro.targetType.toUpperCase()} Fleet Update ({pkg?.version || 'Latest'})
                  </Text>
                  <Text style={styles.rolloutMeta}>
                    Targeted Fleet: {ro.totalDevices} units • Successfully Updated: {ro.updatedDevices} units
                  </Text>
                </View>
                <StatusBadge status={ro.status} />
              </View>

              {/* Progress Bar */}
              <View style={styles.progressBarWrap}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${ro.progressPercent}%` },
                    isRollback && styles.progressRollback,
                    isComplete && styles.progressComplete,
                  ]}
                />
              </View>

              <View style={styles.rolloutFooter}>
                <Text style={styles.progressText}>{ro.progressPercent}% Completed</Text>

                {ro.status === 'in_progress' && (
                  <TouchableOpacity
                    style={styles.rollbackBtn}
                    onPress={() => handleRollback(ro.id)}
                  >
                    <MaterialCommunityIcons name="backup-restore" size={14} color="#dc2626" />
                    <Text style={styles.rollbackBtnText}>Simulate Rollback</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
      </View>

      {/* Firmware Package Catalog */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Firmware Package Repository</Text>
      <View style={styles.packagesGrid}>
        {packages.map((pkg) => {
          const targetDevs = devices.filter((d) => d.type === pkg.deviceType);

          return (
            <View key={pkg.id} style={styles.pkgCard}>
              <View style={styles.pkgHeader}>
                <View style={styles.pkgIconWrap}>
                  <MaterialCommunityIcons name="chip" size={22} color="#4f46e5" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pkgVersion}>{pkg.version}</Text>
                  <Text style={styles.pkgType}>Target: {pkg.deviceType.toUpperCase()}</Text>
                </View>
                <StatusBadge status={pkg.status} size="sm" />
              </View>

              <Text style={styles.pkgChangelog}>{pkg.changelog}</Text>

              {/* SHA-256 Checksum block */}
              <View style={styles.checksumBox}>
                <Text style={styles.checksumLabel}>SHA-256 SIGNATURE</Text>
                <Text style={styles.checksumVal} numberOfLines={1}>
                  {pkg.checksumSha256}
                </Text>
              </View>

              <View style={styles.pkgFooter}>
                <Text style={styles.fleetInfo}>{targetDevs.length} Compatible Units</Text>
                <TouchableOpacity
                  style={styles.rolloutActionBtn}
                  onPress={() => handleStartRollout(pkg)}
                >
                  <MaterialCommunityIcons name="rocket-launch-outline" size={14} color="#ffffff" />
                  <Text style={styles.rolloutActionBtnText}>Trigger Rollout</Text>
                </TouchableOpacity>
              </View>
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
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  rolloutsList: {
    gap: 12,
  },
  rolloutCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
  },
  rolloutHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  rolloutTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  rolloutMeta: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  progressBarWrap: {
    height: 8,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#4f46e5',
  },
  progressRollback: {
    backgroundColor: '#9333ea',
  },
  progressComplete: {
    backgroundColor: '#16a34a',
  },
  rolloutFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  rollbackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fee2e2',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  rollbackBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#dc2626',
  },
  packagesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  pkgCard: {
    flex: 1,
    minWidth: 300,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
  },
  pkgHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  pkgIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#eef2ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pkgVersion: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  pkgType: {
    fontSize: 11,
    color: '#64748b',
  },
  pkgChangelog: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 16,
    marginBottom: 12,
  },
  checksumBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    padding: 8,
    marginBottom: 12,
  },
  checksumLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  checksumVal: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#475569',
  },
  pkgFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fleetInfo: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
  },
  rolloutActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#4f46e5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  rolloutActionBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
  },
});
