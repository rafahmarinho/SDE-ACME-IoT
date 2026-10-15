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
import { subscribeToSimulation } from '../../src/services/simulation';
import { logAuditEvent } from '../../src/services/security';
import { Alert, AlertSeverity } from '../../src/types';

export default function AlertsScreen() {
  const [activeOrgId, setActiveOrgId] = useState(AppStorage.getActiveOrgId());
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('active');

  const loadData = () => {
    const orgId = AppStorage.getActiveOrgId();
    setActiveOrgId(orgId);
    setAlerts(AppStorage.getAlerts().filter((a) => a.organizationId === orgId));
  };

  useEffect(() => {
    loadData();
    return subscribeToSimulation(() => {
      loadData();
    });
  }, []);

  const handleAcknowledge = (id: string) => {
    const all = AppStorage.getAlerts();
    const target = all.find((a) => a.id === id);
    if (target) {
      target.status = 'acknowledged';
      AppStorage.setAlerts(all);
      logAuditEvent('alert_acknowledged', { alertId: id, title: target.title });
      loadData();
    }
  };

  const handleResolve = (id: string) => {
    const all = AppStorage.getAlerts();
    const target = all.find((a) => a.id === id);
    if (target) {
      target.status = 'resolved';
      target.resolvedAt = new Date().toISOString();
      AppStorage.setAlerts(all);
      logAuditEvent('alert_resolved', { alertId: id, title: target.title });
      loadData();
    }
  };

  const filteredAlerts = alerts.filter((a) => {
    const matchesSev = filterSeverity === 'all' || a.severity === filterSeverity;
    const matchesStat = filterStatus === 'all' || a.status === filterStatus;
    return matchesSev && matchesStat;
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.heading}>Incident & Telemetry Alerts</Text>
          <Text style={styles.subheading}>
            Real-time threshold breaches, offline indicators, and battery degradation events
          </Text>
        </View>
      </View>

      {/* Filter Row */}
      <View style={styles.filterBar}>
        <View style={styles.filterGroup}>
          <Text style={styles.filterLabel}>Severity:</Text>
          {['all', 'critical', 'warning', 'info'].map((sev) => (
            <TouchableOpacity
              key={sev}
              style={[styles.filterChip, filterSeverity === sev && styles.filterChipActive]}
              onPress={() => setFilterSeverity(sev)}
            >
              <Text style={[styles.filterChipText, filterSeverity === sev && styles.filterChipTextActive]}>
                {sev.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.filterGroup}>
          <Text style={styles.filterLabel}>Status:</Text>
          {['active', 'acknowledged', 'resolved', 'all'].map((st) => (
            <TouchableOpacity
              key={st}
              style={[styles.filterChip, filterStatus === st && styles.filterChipActive]}
              onPress={() => setFilterStatus(st)}
            >
              <Text style={[styles.filterChipText, filterStatus === st && styles.filterChipTextActive]}>
                {st.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Alerts list */}
      <View style={styles.list}>
        {filteredAlerts.length > 0 ? (
          filteredAlerts.map((al) => {
            const isCritical = al.severity === 'critical';
            const isWarning = al.severity === 'warning';

            return (
              <View
                key={al.id}
                style={[
                  styles.alertCard,
                  isCritical && styles.alertCardCritical,
                  isWarning && styles.alertCardWarning,
                ]}
              >
                <View style={styles.alertHeader}>
                  <View style={styles.titleArea}>
                    <MaterialCommunityIcons
                      name={isCritical ? 'alert-octagon' : isWarning ? 'alert-outline' : 'information'}
                      size={20}
                      color={isCritical ? '#dc2626' : isWarning ? '#d97706' : '#2563eb'}
                    />
                    <Text style={styles.alertTitle}>{al.title}</Text>
                  </View>
                  <View
                    style={[
                      styles.statusPill,
                      al.status === 'resolved' && styles.statusResolved,
                    ]}
                  >
                    <Text style={styles.statusPillText}>{al.status.toUpperCase()}</Text>
                  </View>
                </View>

                <Text style={styles.alertMessage}>{al.message}</Text>

                <View style={styles.alertFooter}>
                  <Text style={styles.timestamp}>
                    Reported: {new Date(al.createdAt).toLocaleString()}
                  </Text>

                  {al.status !== 'resolved' && (
                    <View style={styles.actionsGroup}>
                      {al.status === 'active' && (
                        <TouchableOpacity
                          style={styles.ackBtn}
                          onPress={() => handleAcknowledge(al.id)}
                        >
                          <Text style={styles.ackBtnText}>Acknowledge</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={styles.resolveBtn}
                        onPress={() => handleResolve(al.id)}
                      >
                        <Text style={styles.resolveBtnText}>Mark Resolved</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            );
          })
        ) : (
          <View style={styles.emptyCard}>
            <MaterialCommunityIcons name="check-decagram" size={44} color="#10b981" />
            <Text style={styles.emptyTitle}>All Systems Nominal</Text>
            <Text style={styles.emptySub}>
              No alerts match the selected severity and status filter.
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
    marginBottom: 16,
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
  filterBar: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginBottom: 20,
    gap: 10,
  },
  filterGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  filterLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    width: 60,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
  },
  filterChipActive: {
    backgroundColor: '#4f46e5',
  },
  filterChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
  },
  filterChipTextActive: {
    color: '#ffffff',
  },
  list: {
    gap: 12,
  },
  alertCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
  },
  alertCardCritical: {
    borderLeftWidth: 4,
    borderLeftColor: '#dc2626',
  },
  alertCardWarning: {
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
  },
  alertHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  titleArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  alertTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  statusPill: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusResolved: {
    backgroundColor: '#dcfce7',
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#991b1b',
  },
  alertMessage: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
    marginBottom: 12,
  },
  alertFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 10,
    flexWrap: 'wrap',
    gap: 8,
  },
  timestamp: {
    fontSize: 11,
    color: '#94a3b8',
  },
  actionsGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  ackBtn: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  ackBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  resolveBtn: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  resolveBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803d',
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
    marginTop: 10,
  },
  emptySub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
});
