import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { INITIAL_USERS } from '../../src/mock/initialData';
import { AppStorage } from '../../src/services/storage';
import { logAuditEvent } from '../../src/services/security';
import { UserProfile, UserRole } from '../../src/types';

export default function TeamScreen() {
  const [users, setUsers] = useState<UserProfile[]>(INITIAL_USERS);
  const [modalVisible, setModalVisible] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('operator');

  const getRoleBadge = (r: UserRole) => {
    switch (r) {
      case 'owner': return { bg: '#fee2e2', text: '#991b1b' };
      case 'administrator': return { bg: '#e0e7ff', text: '#4338ca' };
      case 'operator': return { bg: '#dcfce7', text: '#15803d' };
      case 'viewer': return { bg: '#f1f5f9', text: '#475569' };
    }
  };

  const handleInvite = () => {
    if (!fullName.trim() || !email.trim()) return;

    const newUser: UserProfile = {
      id: 'u_' + Date.now(),
      email: email.trim(),
      fullName: fullName.trim(),
      organizationId: AppStorage.getActiveOrgId(),
      role,
      createdAt: new Date().toISOString(),
    };

    setUsers([...users, newUser]);
    logAuditEvent('team_member_invited', { email: newUser.email, role: newUser.role });
    setModalVisible(false);
    setFullName('');
    setEmail('');
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.heading}>Team Access & RBAC Matrix</Text>
          <Text style={styles.subheading}>
            Manage operator permissions, administrators, and view-only audit roles
          </Text>
        </View>

        <TouchableOpacity style={styles.inviteBtn} onPress={() => setModalVisible(true)}>
          <MaterialCommunityIcons name="account-plus-outline" size={18} color="#ffffff" />
          <Text style={styles.inviteBtnText}>Invite Team Member</Text>
        </TouchableOpacity>
      </View>

      {/* Permission Matrix Summary Card */}
      <View style={styles.matrixCard}>
        <Text style={styles.matrixTitle}>Role Permission Matrix</Text>
        <View style={styles.matrixTable}>
          <View style={styles.matrixHeaderRow}>
            <Text style={[styles.matrixCell, { flex: 2, fontWeight: '700' }]}>Permission Scope</Text>
            <Text style={styles.matrixCell}>Owner</Text>
            <Text style={styles.matrixCell}>Admin</Text>
            <Text style={styles.matrixCell}>Operator</Text>
            <Text style={styles.matrixCell}>Viewer</Text>
          </View>

          {[
            { scope: 'Device Read & Telemetry', owner: true, admin: true, operator: true, viewer: true },
            { scope: 'Device Control (Setpoint / Power)', owner: true, admin: true, operator: true, viewer: false },
            { scope: 'Automations (Create / Toggle)', owner: true, admin: true, operator: true, viewer: false },
            { scope: 'Alert Resolution', owner: true, admin: true, operator: true, viewer: false },
            { scope: 'Firmware OTA Rollout & Rollback', owner: true, admin: true, operator: false, viewer: false },
            { scope: 'Team & RBAC Management', owner: true, admin: true, operator: false, viewer: false },
          ].map((row, idx) => (
            <View key={idx} style={styles.matrixRow}>
              <Text style={[styles.matrixCell, { flex: 2, color: '#0f172a' }]}>{row.scope}</Text>
              <Text style={styles.matrixCell}>{row.owner ? '✅' : '❌'}</Text>
              <Text style={styles.matrixCell}>{row.admin ? '✅' : '❌'}</Text>
              <Text style={styles.matrixCell}>{row.operator ? '✅' : '❌'}</Text>
              <Text style={styles.matrixCell}>{row.viewer ? '✅' : '❌'}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Team Member Cards */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Active Members ({users.length})</Text>
      <View style={styles.usersList}>
        {users.map((u) => {
          const badge = getRoleBadge(u.role);
          return (
            <View key={u.id} style={styles.userCard}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{u.fullName.charAt(0)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>{u.fullName}</Text>
                <Text style={styles.userEmail}>{u.email}</Text>
              </View>
              <View style={[styles.roleBadge, { backgroundColor: badge.bg }]}>
                <Text style={[styles.roleBadgeText, { color: badge.text }]}>
                  {u.role.toUpperCase()}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Invite Modal */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite Colleague</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Full Name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Jordan Miller"
                value={fullName}
                onChangeText={setFullName}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Corporate Email</Text>
              <TextInput
                style={styles.input}
                placeholder="jordan.miller@company.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Assigned Role</Text>
              <View style={styles.rolePickerRow}>
                {(['administrator', 'operator', 'viewer'] as UserRole[]).map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.roleOption, role === r && styles.roleOptionSelected]}
                    onPress={() => setRole(r)}
                  >
                    <Text
                      style={[
                        styles.roleOptionText,
                        role === r && styles.roleOptionTextSelected,
                      ]}
                    >
                      {r.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity style={styles.sendBtn} onPress={handleInvite}>
              <Text style={styles.sendBtnText}>Dispatch Secure Invitation</Text>
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
  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#4f46e5',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  inviteBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  matrixCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
  },
  matrixTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  matrixTable: {
    borderWidth: 1,
    borderColor: '#f1f5f9',
    borderRadius: 8,
    overflow: 'hidden',
  },
  matrixHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  matrixRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  matrixCell: {
    flex: 1,
    fontSize: 11,
    textAlign: 'center',
    color: '#475569',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  usersList: {
    gap: 10,
  },
  userCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  userName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  userEmail: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
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
  rolePickerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  roleOption: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  roleOptionSelected: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  roleOptionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  roleOptionTextSelected: {
    color: '#ffffff',
  },
  sendBtn: {
    backgroundColor: '#4f46e5',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  sendBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
