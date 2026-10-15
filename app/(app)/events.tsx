import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppStorage } from '../../src/services/storage';
import { subscribeToSimulation } from '../../src/services/simulation';
import { EventLog } from '../../src/types';

export default function EventsScreen() {
  const [activeOrgId, setActiveOrgId] = useState(AppStorage.getActiveOrgId());
  const [events, setEvents] = useState<EventLog[]>([]);
  const [filterType, setFilterType] = useState<string>('all');
  const [selectedEvent, setSelectedEvent] = useState<EventLog | null>(null);

  const loadData = () => {
    const orgId = AppStorage.getActiveOrgId();
    setActiveOrgId(orgId);
    setEvents(AppStorage.getEvents().filter((e) => e.organizationId === orgId));
  };

  useEffect(() => {
    loadData();
    return subscribeToSimulation(() => {
      loadData();
    });
  }, []);

  const eventTypes = [
    { id: 'all', label: 'All Streams' },
    { id: 'telemetry', label: 'Telemetry' },
    { id: 'state_change', label: 'State Changes' },
    { id: 'alert_triggered', label: 'Alerts' },
    { id: 'security_audit', label: 'Security Audits' },
    { id: 'firmware_updated', label: 'Firmware' },
    { id: 'enrollment', label: 'Enrollments' },
  ];

  const filteredEvents = events.filter(
    (e) => filterType === 'all' || e.eventType === filterType
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.heading}>Telemetry & Audit Event Log</Text>
          <Text style={styles.subheading}>
            Immutable stream of state modifications, automation executions, and security audits
          </Text>
        </View>
      </View>

      {/* Filter Row */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        {eventTypes.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={[styles.filterChip, filterType === t.id && styles.filterChipActive]}
            onPress={() => setFilterType(t.id)}
          >
            <Text style={[styles.filterChipText, filterType === t.id && styles.filterChipTextActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Event list */}
      <View style={styles.list}>
        {filteredEvents.map((ev) => (
          <TouchableOpacity
            key={ev.id}
            style={styles.eventCard}
            onPress={() => setSelectedEvent(ev)}
          >
            <View style={styles.iconCircle}>
              <MaterialCommunityIcons
                name={
                  ev.eventType === 'security_audit'
                    ? 'shield-check-outline'
                    : ev.eventType === 'state_change'
                    ? 'swap-horizontal'
                    : ev.eventType === 'alert_triggered'
                    ? 'bell-alert-outline'
                    : ev.eventType === 'firmware_updated'
                    ? 'cloud-upload-outline'
                    : 'chip'
                }
                size={18}
                color="#4f46e5"
              />
            </View>

            <View style={{ flex: 1 }}>
              <View style={styles.cardHeader}>
                <Text style={styles.eventType}>{ev.eventType.replace('_', ' ').toUpperCase()}</Text>
                <Text style={styles.eventTime}>
                  {new Date(ev.createdAt).toLocaleTimeString()} • {new Date(ev.createdAt).toLocaleDateString()}
                </Text>
              </View>

              <Text style={styles.payloadSummary} numberOfLines={2}>
                {JSON.stringify(ev.payload)}
              </Text>

              <View style={styles.cardFooter}>
                <Text style={styles.actorInfo}>
                  Actor Role: {ev.actorRole ? ev.actorRole.toUpperCase() : 'SYSTEM'}
                </Text>
                <Text style={styles.inspectBtnText}>Inspect Payload →</Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* Inspect Event Modal */}
      <Modal visible={Boolean(selectedEvent)} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Event Packet Details</Text>
              <TouchableOpacity onPress={() => setSelectedEvent(null)}>
                <MaterialCommunityIcons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            {selectedEvent && (
              <View>
                <View style={styles.modalMetaRow}>
                  <Text style={styles.metaLabel}>ID:</Text>
                  <Text style={styles.metaVal}>{selectedEvent.id}</Text>
                </View>
                <View style={styles.modalMetaRow}>
                  <Text style={styles.metaLabel}>Type:</Text>
                  <Text style={styles.metaVal}>{selectedEvent.eventType}</Text>
                </View>
                <View style={styles.modalMetaRow}>
                  <Text style={styles.metaLabel}>Actor Role:</Text>
                  <Text style={styles.metaVal}>{selectedEvent.actorRole || 'system'}</Text>
                </View>
                <View style={styles.modalMetaRow}>
                  <Text style={styles.metaLabel}>Timestamp:</Text>
                  <Text style={styles.metaVal}>{selectedEvent.createdAt}</Text>
                </View>

                <Text style={[styles.metaLabel, { marginTop: 12, marginBottom: 4 }]}>
                  Structured JSON Payload:
                </Text>
                <View style={styles.jsonBox}>
                  <Text style={styles.jsonText}>
                    {JSON.stringify(selectedEvent.payload, null, 2)}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
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
  filterRow: {
    flexDirection: 'row',
    marginBottom: 18,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  filterChipTextActive: {
    color: '#ffffff',
  },
  list: {
    gap: 10,
  },
  eventCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#eef2ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  eventType: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4f46e5',
    letterSpacing: 0.5,
  },
  eventTime: {
    fontSize: 10,
    color: '#94a3b8',
  },
  payloadSummary: {
    fontSize: 12,
    color: '#334155',
    marginBottom: 6,
    fontFamily: 'monospace',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f8fafc',
    paddingTop: 6,
  },
  actorInfo: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
  },
  inspectBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4f46e5',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 540,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  modalMetaRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  metaLabel: {
    width: 90,
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  metaVal: {
    flex: 1,
    fontSize: 12,
    color: '#0f172a',
    fontWeight: '600',
  },
  jsonBox: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 12,
    maxHeight: 250,
  },
  jsonText: {
    color: '#38bdf8',
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
