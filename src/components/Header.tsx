import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppStorage } from '../services/storage';
import { UserRole, UserProfile } from '../types';
import { INITIAL_USERS } from '../mock/initialData';

interface HeaderProps {
  onOrgChange?: (orgId: string) => void;
  onRoleChange?: (user: UserProfile) => void;
}

export const Header: React.FC<HeaderProps> = ({ onOrgChange, onRoleChange }) => {
  const [currentUser, setCurrentUser] = useState<UserProfile>(AppStorage.getCurrentUser());
  const [orgs] = useState(AppStorage.getOrganizations());
  const [activeOrgId, setActiveOrgId] = useState<string>(AppStorage.getActiveOrgId());
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showOrgModal, setShowOrgModal] = useState(false);

  const activeOrg = orgs.find((o) => o.id === activeOrgId) || orgs[0];

  const handleSelectRole = (user: UserProfile) => {
    AppStorage.setCurrentUser(user);
    setCurrentUser(user);
    setShowRoleModal(false);
    if (onRoleChange) onRoleChange(user);
  };

  const handleSelectOrg = (orgId: string) => {
    AppStorage.setActiveOrgId(orgId);
    setActiveOrgId(orgId);
    setShowOrgModal(false);
    if (onOrgChange) onOrgChange(orgId);
  };

  const getRoleBadgeColor = (role: UserRole) => {
    switch (role) {
      case 'owner': return { bg: '#fee2e2', text: '#991b1b' };
      case 'administrator': return { bg: '#e0e7ff', text: '#4338ca' };
      case 'operator': return { bg: '#dcfce7', text: '#166534' };
      case 'viewer': return { bg: '#f1f5f9', text: '#475569' };
    }
  };

  const roleStyle = getRoleBadgeColor(currentUser.role);

  return (
    <View style={styles.header}>
      {/* Brand logo & title */}
      <View style={styles.brandRow}>
        <View style={styles.logoBadge}>
          <MaterialCommunityIcons name="access-point-network" size={20} color="#ffffff" />
        </View>
        <View>
          <Text style={styles.brandTitle}>ACME IoT</Text>
          <Text style={styles.brandSubtitle}>Intelligent Facility OS</Text>
        </View>
      </View>

      {/* Center Organization Switcher */}
      <TouchableOpacity
        style={styles.orgDropdownBtn}
        onPress={() => setShowOrgModal(true)}
      >
        <MaterialCommunityIcons name="domain" size={16} color="#4f46e5" />
        <Text style={styles.orgDropdownText} numberOfLines={1}>
          {activeOrg?.name}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={16} color="#64748b" />
      </TouchableOpacity>

      {/* User profile & quick role switcher */}
      <TouchableOpacity
        style={styles.userProfileBtn}
        onPress={() => setShowRoleModal(true)}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {currentUser.fullName.charAt(0)}
          </Text>
        </View>
        <View style={styles.userInfoCol}>
          <Text style={styles.userName} numberOfLines={1}>
            {currentUser.fullName.split(' ')[0]}
          </Text>
          <View style={[styles.roleBadge, { backgroundColor: roleStyle.bg }]}>
            <Text style={[styles.roleBadgeText, { color: roleStyle.text }]}>
              {currentUser.role.toUpperCase()}
            </Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Org Modal */}
      <Modal visible={showOrgModal} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setShowOrgModal(false)}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalHeading}>Select Organization</Text>
            {orgs.map((org) => (
              <TouchableOpacity
                key={org.id}
                style={[
                  styles.modalItem,
                  org.id === activeOrgId && styles.modalItemSelected,
                ]}
                onPress={() => handleSelectOrg(org.id)}
              >
                <MaterialCommunityIcons name="domain" size={18} color="#4f46e5" />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.modalItemTitle}>{org.name}</Text>
                  <Text style={styles.modalItemSub}>Plan: {org.plan.toUpperCase()}</Text>
                </View>
                {org.id === activeOrgId && (
                  <MaterialCommunityIcons name="check" size={18} color="#4f46e5" />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Quick Role Switcher Modal */}
      <Modal visible={showRoleModal} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setShowRoleModal(false)}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalHeading}>Simulate User Role (RBAC)</Text>
            <Text style={styles.modalSubheading}>
              Switch persona to test role-adapted navigation and permission limits:
            </Text>
            {INITIAL_USERS.map((u) => {
              const isSelected = u.id === currentUser.id;
              const badge = getRoleBadgeColor(u.role);
              return (
                <TouchableOpacity
                  key={u.id}
                  style={[styles.modalItem, isSelected && styles.modalItemSelected]}
                  onPress={() => handleSelectRole(u)}
                >
                  <View style={[styles.roleBadge, { backgroundColor: badge.bg, marginRight: 10 }]}>
                    <Text style={[styles.roleBadgeText, { color: badge.text }]}>
                      {u.role.toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalItemTitle}>{u.fullName}</Text>
                    <Text style={styles.modalItemSub}>{u.email}</Text>
                  </View>
                  {isSelected && (
                    <MaterialCommunityIcons name="check" size={18} color="#4f46e5" />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#4f46e5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  brandSubtitle: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '500',
  },
  orgDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
    maxWidth: 240,
  },
  orgDropdownText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1e293b',
    flexShrink: 1,
  },
  userProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  userInfoCol: {
    justifyContent: 'center',
  },
  userName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    marginTop: 2,
    alignSelf: 'flex-start',
  },
  roleBadgeText: {
    fontSize: 9,
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
    padding: 20,
    width: '100%',
    maxWidth: 420,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 15,
  },
  modalHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
  },
  modalSubheading: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 14,
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  modalItemSelected: {
    backgroundColor: '#f5f3ff',
    borderColor: '#c4b5fd',
  },
  modalItemTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  modalItemSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
});
