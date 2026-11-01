import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Slot, useRouter, usePathname, Redirect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Header } from '../../src/components/Header';
import { ScenarioBar } from '../../src/components/ScenarioBar';
import { OfflineNotice } from '../../src/components/OfflineNotice';
import { AppStorage } from '../../src/services/storage';
import { AuthService } from '../../src/services/supabase';
import { UserProfile, UserRole } from '../../src/types';
import { hasPermission, canAccessRoute } from '../../src/services/security';
import { SimulationEngine, subscribeToSimulation } from '../../src/services/simulation';
import { DataGateway } from '../../src/services/dataGateway';
import { ActionError } from '../../src/components/ActionError';

interface NavItem {
  id: string;
  label: string;
  icon: any;
  route: string;
  minRole?: UserRole;
  requiredPermission?: Parameters<typeof hasPermission>[1];
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'view-dashboard-outline', route: '/(app)/dashboard' },
  { id: 'buildings', label: 'Buildings', icon: 'office-building', route: '/(app)/buildings' },
  { id: 'rooms', label: 'Rooms & 3D', icon: 'cube-outline', route: '/(app)/rooms' },
  { id: 'devices', label: 'Devices', icon: 'chip', route: '/(app)/devices' },
  { id: 'automations', label: 'Automations', icon: 'robot-outline', route: '/(app)/automations' },
  { id: 'alerts', label: 'Alerts', icon: 'bell-alert-outline', route: '/(app)/alerts' },
  { id: 'events', label: 'Events & Audit', icon: 'format-list-bulleted-type', route: '/(app)/events' },
  { id: 'firmware', label: 'Firmware OTA', icon: 'cloud-upload-outline', route: '/(app)/firmware' },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: 'webhook',
    route: '/(app)/integrations',
    requiredPermission: 'integrations:manage',
  },
  {
    id: 'team',
    label: 'Team & RBAC',
    icon: 'account-group-outline',
    route: '/(app)/team',
    requiredPermission: 'team:manage',
  },
  { id: 'settings', label: 'Settings', icon: 'cog-outline', route: '/(app)/settings' },
];

export default function AppLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const [user, setUser] = useState<UserProfile | null>(AppStorage.getSessionUser());
  const [authChecked, setAuthChecked] = useState(false);
  const [showLogoutReminder, setShowLogoutReminder] = useState(AppStorage.shouldShowLogoutReminder());
  const [isOffline, setIsOffline] = useState<boolean>(AppStorage.isOfflineMode());
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const serverMode = DataGateway.isServerMode();

  const isDesktop = width >= 768;

  // SDE T16, T338, T373: route guard. Every screen in this group requires a verified session;
  // without one the user is sent to the public login page.
  useEffect(() => {
    let active = true;
    AuthService.restoreSession().then((sessionUser) => {
      if (!active) return;
      setUser(sessionUser);
      setAuthChecked(true);
    });
    const unsubscribe = AuthService.onSessionEnded(() => {
      if (active) setUser(null);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // SDE T26: data processes only run inside an authenticated session. In server mode the app polls the
  // API (the source of truth); the local simulation exists only in demo builds (SDE T17, T145).
  const sessionUserId = user?.id;
  useEffect(() => {
    if (!sessionUserId) return;
    if (serverMode) {
      DataGateway.startSync();
      return () => {
        DataGateway.stopSync();
      };
    }
    SimulationEngine.start(3500);
    return () => {
      SimulationEngine.stop();
    };
  }, [sessionUserId, serverMode]);

  useEffect(() => {
    return subscribeToSimulation(() => {
      setIsOffline(AppStorage.isOfflineMode());
      setSyncError(DataGateway.getLastSyncError());
    });
  }, []);

  if (!authChecked) {
    return (
      <View style={styles.guardLoading}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  const handleRoleChange = (newUser: UserProfile) => {
    setUser(newUser);
    setRefreshKey((k) => k + 1);
  };

  const handleOrgChange = () => {
    setRefreshKey((k) => k + 1);
  };

  // SDE T16: navigation and page access use the same central route map (deny by default).
  // A page the role cannot open is never rendered; the user is sent to a page they can open.
  if (!canAccessRoute(user.role, pathname)) {
    return <Redirect href={canAccessRoute(user.role, '/dashboard') ? '/(app)/dashboard' : '/(app)/settings'} />;
  }
  const visibleNavItems = NAV_ITEMS.filter((item) => canAccessRoute(user.role, item.route.replace('/(app)', '')));

  return (
    <View style={styles.root}>
      {/* Top Header */}
      <Header onRoleChange={handleRoleChange} onOrgChange={handleOrgChange} />

      {/* Scenario & Advance Simulation Controller (local demo only; server data is never simulated) */}
      {!serverMode && <ScenarioBar onReset={() => setRefreshKey((k) => k + 1)} />}

      {/* Offline Banner when offline mode is enabled or network drops */}
      <OfflineNotice isOffline={isOffline} />

      {/* Server refusals while loading data (for example a result set above the allowed size) */}
      {syncError && (
        <View style={styles.syncErrorWrap}>
          <ActionError message={syncError} />
        </View>
      )}

      {/* SDE T26: reminder when the previous session was never closed with an explicit logout */}
      {showLogoutReminder && (
        <View style={styles.reminderBanner}>
          <MaterialCommunityIcons name="shield-alert-outline" size={16} color="#92400e" />
          <Text style={styles.reminderText}>
            Your previous session was not signed out. Use Sign Out in Settings when you finish, especially on shared devices.
          </Text>
          <TouchableOpacity
            onPress={() => {
              AppStorage.setLogoutReminder(false);
              setShowLogoutReminder(false);
            }}
          >
            <MaterialCommunityIcons name="close" size={16} color="#92400e" />
          </TouchableOpacity>
        </View>
      )}

      {/* Body Area with Responsive Sidebar and Content */}
      <View style={styles.body}>
        {isDesktop && (
          <View style={styles.sidebar}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sidebarContent}>
              <Text style={styles.navSectionHeading}>MAIN NAVIGATION</Text>
              {visibleNavItems.map((item) => {
                const isActive = pathname.includes(item.id);
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.sidebarItem, isActive && styles.sidebarItemActive]}
                    onPress={() => router.push(item.route as any)}
                  >
                    <MaterialCommunityIcons
                      name={item.icon}
                      size={20}
                      color={isActive ? '#4f46e5' : '#64748b'}
                    />
                    <Text style={[styles.sidebarItemText, isActive && styles.sidebarItemTextActive]}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Screen Content */}
        <View style={styles.mainContent}>
          <Slot />
        </View>
      </View>

      {/* Mobile Bottom Tab Navigation */}
      {!isDesktop && (
        <View style={styles.mobileTabBar}>
          {visibleNavItems.slice(0, 5).map((item) => {
            const isActive = pathname.includes(item.id);
            return (
              <TouchableOpacity
                key={item.id}
                style={styles.mobileTabItem}
                onPress={() => router.push(item.route as any)}
              >
                <MaterialCommunityIcons
                  name={item.icon}
                  size={22}
                  color={isActive ? '#4f46e5' : '#94a3b8'}
                />
                <Text style={[styles.mobileTabLabel, isActive && styles.mobileTabLabelActive]}>
                  {item.label.split(' ')[0]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  guardLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  reminderBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef3c7',
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  reminderText: {
    flex: 1,
    fontSize: 12,
    color: '#92400e',
    fontWeight: '600',
  },
  syncErrorWrap: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 230,
    backgroundColor: '#ffffff',
    borderRightWidth: 1,
    borderRightColor: '#e2e8f0',
  },
  sidebarContent: {
    paddingVertical: 16,
    paddingHorizontal: 10,
  },
  navSectionHeading: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.8,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    marginBottom: 4,
  },
  sidebarItemActive: {
    backgroundColor: '#eef2ff',
  },
  sidebarItemText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  sidebarItemTextActive: {
    color: '#4f46e5',
    fontWeight: '700',
  },
  mainContent: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  mobileTabBar: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingVertical: 8,
    justifyContent: 'space-around',
  },
  mobileTabItem: {
    alignItems: 'center',
    gap: 2,
  },
  mobileTabLabel: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
  },
  mobileTabLabelActive: {
    color: '#4f46e5',
    fontWeight: '700',
  },
});
