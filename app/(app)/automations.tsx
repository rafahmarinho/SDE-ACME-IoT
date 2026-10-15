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
import { subscribeToSimulation } from '../../src/services/simulation';
import { Automation, Device } from '../../src/types';

export default function AutomationsScreen() {
  const [activeOrgId, setActiveOrgId] = useState(AppStorage.getActiveOrgId());
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [modalVisible, setModalVisible] = useState(false);

  // New Rule Form
  const [ruleName, setRuleName] = useState('');
  const [sourceDeviceId, setSourceDeviceId] = useState('');
  const [targetDeviceId, setTargetDeviceId] = useState('');
  const [operator, setOperator] = useState<'>=' | '<=' | '==' | '!='>('>=');
  const [thresholdVal, setThresholdVal] = useState('25.0');
  const [actionCommand, setActionCommand] = useState<'set_target_temp' | 'set_power'>('set_target_temp');
  const [actionVal, setActionVal] = useState('20.0');
  const [intervalSecs, setIntervalSecs] = useState('60');

  const loadData = () => {
    const orgId = AppStorage.getActiveOrgId();
    setActiveOrgId(orgId);
    const autos = AppStorage.getAutomations().filter((a) => a.organizationId === orgId);
    const devs = AppStorage.getDevices().filter((d) => d.organizationId === orgId);
    setAutomations(autos);
    setDevices(devs);

    if (devs.length > 0 && !sourceDeviceId) {
      setSourceDeviceId(devs[0].id);
      setTargetDeviceId(devs[1]?.id || devs[0].id);
    }
  };

  useEffect(() => {
    loadData();
    return subscribeToSimulation(() => {
      loadData();
    });
  }, []);

  const handleToggleRule = (id: string, currentVal: boolean) => {
    const all = AppStorage.getAutomations();
    const target = all.find((a) => a.id === id);
    if (target) {
      target.enabled = !currentVal;
      AppStorage.setAutomations(all);
      loadData();
    }
  };

  const handleCreateRule = () => {
    if (!ruleName.trim()) return;

    const newRule: Automation = {
      id: 'a_' + Date.now(),
      organizationId: activeOrgId,
      name: ruleName.trim(),
      enabled: true,
      triggerType: actionCommand === 'set_target_temp' ? 'temperature_threshold' : 'power_threshold',
      triggerCondition: {
        deviceId: sourceDeviceId,
        metric: 'current_temp',
        operator,
        value: Number(thresholdVal) || 25,
      },
      action: {
        targetDeviceId,
        command: actionCommand,
        value: actionCommand === 'set_target_temp' ? Number(actionVal) || 20 : actionVal,
      },
      intervalSeconds: parseInt(intervalSecs) || 60,
      executionCount: 0,
      notifyOnRun: true,
      createdAt: new Date().toISOString(),
    };

    const current = AppStorage.getAutomations();
    AppStorage.setAutomations([newRule, ...current]);
    setModalVisible(false);
    setRuleName('');
    loadData();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.heading}>Automations & Edge Rules</Text>
          <Text style={styles.subheading}>
            Autonomous condition-action pipelines evaluated at continuous intervals
          </Text>
        </View>

        <TouchableOpacity style={styles.createBtn} onPress={() => setModalVisible(true)}>
          <MaterialCommunityIcons name="plus" size={18} color="#ffffff" />
          <Text style={styles.createBtnText}>Create Automation Rule</Text>
        </TouchableOpacity>
      </View>

      {/* Rules list */}
      <View style={styles.rulesList}>
        {automations.map((rule) => {
          const srcDevice = devices.find((d) => d.id === rule.triggerCondition.deviceId);
          const tgtDevice = devices.find((d) => d.id === rule.action.targetDeviceId);

          return (
            <View key={rule.id} style={styles.ruleCard}>
              <View style={styles.ruleHeader}>
                <View style={styles.ruleTitleRow}>
                  <MaterialCommunityIcons
                    name="robot-outline"
                    size={22}
                    color={rule.enabled ? '#4f46e5' : '#94a3b8'}
                  />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.ruleName}>{rule.name}</Text>
                    <Text style={styles.ruleInterval}>
                      Interval: Every {rule.intervalSeconds}s • Executions: {rule.executionCount}
                    </Text>
                  </View>
                </View>

                <Switch
                  value={rule.enabled}
                  onValueChange={() => handleToggleRule(rule.id, rule.enabled)}
                  trackColor={{ false: '#cbd5e1', true: '#c7d2fe' }}
                  thumbColor={rule.enabled ? '#4f46e5' : '#f8fafc'}
                />
              </View>

              {/* Condition & Action Logic Box */}
              <View style={styles.logicBox}>
                <View style={styles.conditionPart}>
                  <Text style={styles.logicLabel}>IF TRIGGER (SOURCE)</Text>
                  <Text style={styles.logicText}>
                    {srcDevice?.name || 'Device'} ({srcDevice?.code}){' '}
                    <Text style={styles.operatorText}>
                      {rule.triggerCondition.operator} {rule.triggerCondition.value}
                    </Text>
                  </Text>
                </View>

                <MaterialCommunityIcons
                  name="arrow-right-bold"
                  size={18}
                  color="#6366f1"
                  style={styles.arrowIcon}
                />

                <View style={styles.actionPart}>
                  <Text style={styles.logicLabel}>THEN ACTION (TARGET)</Text>
                  <Text style={styles.logicText}>
                    {tgtDevice?.name || 'Target'} ({tgtDevice?.code}) →{' '}
                    <Text style={styles.actionHighlight}>
                      {rule.action.command}: {String(rule.action.value).toUpperCase()}
                    </Text>
                  </Text>
                </View>
              </View>

              {/* Last executed footer */}
              <View style={styles.ruleFooter}>
                <View style={styles.notificationTag}>
                  <MaterialCommunityIcons
                    name={rule.notifyOnRun ? 'bell-check' : 'bell-off'}
                    size={14}
                    color="#64748b"
                  />
                  <Text style={styles.notificationTagText}>
                    {rule.notifyOnRun ? 'Notification Enabled' : 'Silent Mode'}
                  </Text>
                </View>
                <Text style={styles.lastRunText}>
                  Last Run: {rule.lastExecutedAt ? new Date(rule.lastExecutedAt).toLocaleTimeString() : 'Never'}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Create Automation Modal */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Configure Automation Rule</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Rule Description</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Turn off Smart Plug when Room Vacant"
                value={ruleName}
                onChangeText={setRuleName}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Source Trigger Device</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.devicesChipRow}>
                {devices.map((d) => (
                  <TouchableOpacity
                    key={d.id}
                    style={[styles.deviceChip, sourceDeviceId === d.id && styles.deviceChipSelected]}
                    onPress={() => setSourceDeviceId(d.id)}
                  >
                    <Text style={[styles.deviceChipText, sourceDeviceId === d.id && styles.deviceChipTextSelected]}>
                      {d.code} ({d.type})
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.rowInputs}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Condition Operator</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {['>=', '<=', '=='].map((op) => (
                    <TouchableOpacity
                      key={op}
                      style={[styles.opBtn, operator === op && styles.opBtnActive]}
                      onPress={() => setOperator(op as any)}
                    >
                      <Text style={[styles.opBtnText, operator === op && styles.opBtnTextActive]}>
                        {op}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Threshold Value</Text>
                <TextInput
                  style={styles.input}
                  value={thresholdVal}
                  onChangeText={setThresholdVal}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Target Actuator Device</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.devicesChipRow}>
                {devices.map((d) => (
                  <TouchableOpacity
                    key={d.id}
                    style={[styles.deviceChip, targetDeviceId === d.id && styles.deviceChipSelected]}
                    onPress={() => setTargetDeviceId(d.id)}
                  >
                    <Text style={[styles.deviceChipText, targetDeviceId === d.id && styles.deviceChipTextSelected]}>
                      {d.code}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.rowInputs}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Action Command</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <TouchableOpacity
                    style={[styles.opBtn, actionCommand === 'set_target_temp' && styles.opBtnActive]}
                    onPress={() => setActionCommand('set_target_temp')}
                  >
                    <Text style={[styles.opBtnText, actionCommand === 'set_target_temp' && styles.opBtnTextActive]}>
                      Set Temp
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.opBtn, actionCommand === 'set_power' && styles.opBtnActive]}
                    onPress={() => setActionCommand('set_power')}
                  >
                    <Text style={[styles.opBtnText, actionCommand === 'set_power' && styles.opBtnTextActive]}>
                      Set Power
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Action Target Value</Text>
                <TextInput
                  style={styles.input}
                  value={actionVal}
                  onChangeText={setActionVal}
                  placeholder="20.0 or on/off"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Evaluation Interval (Seconds)</Text>
              <TextInput
                style={styles.input}
                value={intervalSecs}
                onChangeText={setIntervalSecs}
                keyboardType="numeric"
              />
            </View>

            <TouchableOpacity style={styles.saveBtn} onPress={handleCreateRule}>
              <Text style={styles.saveBtnText}>Save and Activate Rule</Text>
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
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#4f46e5',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  createBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  rulesList: {
    gap: 14,
  },
  ruleCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
  },
  ruleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  ruleTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  ruleName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  ruleInterval: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  logicBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  conditionPart: {
    flex: 1,
    minWidth: 160,
  },
  arrowIcon: {
    alignSelf: 'center',
  },
  actionPart: {
    flex: 1,
    minWidth: 160,
  },
  logicLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  logicText: {
    fontSize: 12,
    color: '#1e293b',
    fontWeight: '600',
  },
  operatorText: {
    color: '#dc2626',
    fontWeight: '800',
  },
  actionHighlight: {
    color: '#4f46e5',
    fontWeight: '800',
  },
  ruleFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 10,
  },
  notificationTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  notificationTagText: {
    fontSize: 11,
    color: '#64748b',
  },
  lastRunText: {
    fontSize: 11,
    color: '#64748b',
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
    maxWidth: 500,
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
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
  devicesChipRow: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  deviceChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    marginRight: 6,
  },
  deviceChipSelected: {
    backgroundColor: '#eef2ff',
    borderColor: '#4f46e5',
  },
  deviceChipText: {
    fontSize: 11,
    color: '#475569',
  },
  deviceChipTextSelected: {
    color: '#4f46e5',
    fontWeight: '700',
  },
  rowInputs: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  opBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  opBtnActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  opBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  opBtnTextActive: {
    color: '#ffffff',
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
