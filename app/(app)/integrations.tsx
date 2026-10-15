import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Modal,
  TextInput,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppStorage } from '../../src/services/storage';
import { logAuditEvent } from '../../src/services/security';
import { Integration } from '../../src/types';

export default function IntegrationsScreen() {
  const [activeOrgId, setActiveOrgId] = useState(AppStorage.getActiveOrgId());
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [type, setType] = useState<'webhook' | 'rest_api_key' | 'simulated_mqtt'>('webhook');

  const loadData = () => {
    const orgId = AppStorage.getActiveOrgId();
    setActiveOrgId(orgId);
    setIntegrations(AppStorage.getIntegrations().filter((i) => i.organizationId === orgId));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleToggle = (id: string, current: boolean) => {
    const all = AppStorage.getIntegrations();
    const item = all.find((x) => x.id === id);
    if (item) {
      item.active = !current;
      AppStorage.setIntegrations(all);
      logAuditEvent('integration_toggled', { id, name: item.name, active: item.active });
      loadData();
    }
  };

  const handleCreate = () => {
    if (!name.trim()) return;

    const newIntegration: Integration = {
      id: 'i_' + Date.now(),
      organizationId: activeOrgId,
      name: name.trim(),
      type,
      endpointUrl: endpointUrl.trim(),
      apiKeyMasked: 'acme_live_••••••••••••' + Math.random().toString(36).substring(2, 6),
      active: true,
      createdAt: new Date().toISOString(),
    };

    const current = AppStorage.getIntegrations();
    AppStorage.setIntegrations([newIntegration, ...current]);
    logAuditEvent('integration_created', { name: newIntegration.name, type: newIntegration.type });
    setModalVisible(false);
    setName('');
    setEndpointUrl('');
    loadData();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.heading}>External Connectors & Integrations</Text>
          <Text style={styles.subheading}>
            Simulated webhooks, SIEM log forwarding, and cloud API endpoints
          </Text>
        </View>

        <TouchableOpacity style={styles.addBtn} onPress={() => setModalVisible(true)}>
          <MaterialCommunityIcons name="plus" size={18} color="#ffffff" />
          <Text style={styles.addBtnText}>Add Connector</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.list}>
        {integrations.map((item) => (
          <View key={item.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.iconWrap}>
                <MaterialCommunityIcons
                  name={item.type === 'webhook' ? 'webhook' : 'key-outline'}
                  size={20}
                  color="#4f46e5"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemType}>Type: {item.type.toUpperCase()}</Text>
              </View>
              <Switch
                value={item.active}
                onValueChange={() => handleToggle(item.id, item.active)}
                trackColor={{ false: '#cbd5e1', true: '#c7d2fe' }}
                thumbColor={item.active ? '#4f46e5' : '#f8fafc'}
              />
            </View>

            {item.endpointUrl && (
              <View style={styles.endpointBox}>
                <Text style={styles.endpointLabel}>DESTINATION ENDPOINT</Text>
                <Text style={styles.endpointText}>{item.endpointUrl}</Text>
              </View>
            )}

            <View style={styles.cardFooter}>
              <Text style={styles.keyText}>Key: {item.apiKeyMasked || 'N/A'}</Text>
              <Text style={styles.deliveryStatus}>Delivery Status: 100% OK (Simulated)</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Add Modal */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New External Integration</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Integration Name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Datadog Log Forwarder"
                value={name}
                onChangeText={setName}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Destination Endpoint URL</Text>
              <TextInput
                style={styles.input}
                placeholder="https://api.external-service.com/events"
                value={endpointUrl}
                onChangeText={setEndpointUrl}
              />
            </View>

            <TouchableOpacity style={styles.saveBtn} onPress={handleCreate}>
              <Text style={styles.saveBtnText}>Connect Integration</Text>
            </TouchableOpacity>
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
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#4f46e5',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  addBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  list: {
    gap: 12,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#eef2ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  itemType: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  endpointBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    marginBottom: 12,
  },
  endpointLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#94a3b8',
    marginBottom: 2,
  },
  endpointText: {
    fontSize: 12,
    color: '#334155',
    fontFamily: 'monospace',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  keyText: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: 'monospace',
  },
  deliveryStatus: {
    fontSize: 11,
    color: '#15803d',
    fontWeight: '600',
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
    padding: 22,
    width: '100%',
    maxWidth: 460,
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
  inputGroup: {
    marginBottom: 14,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
  },
  saveBtn: {
    backgroundColor: '#4f46e5',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
