import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AuthService, isSupabaseConfigured } from '../../src/services/supabase';
import { INITIAL_USERS } from '../../src/mock/initialData';
import { AppStorage } from '../../src/services/storage';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('sarah.chen@acme-iot.com');
  const [password, setPassword] = useState('SuperSecretP@ssword123!');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await AuthService.signIn(email, password);
      if (result.error) {
        setError(result.error);
      } else {
        router.replace('/(app)/dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickSelect = (u: (typeof INITIAL_USERS)[0]) => {
    setEmail(u.email);
    setPassword('DemoPass2026!');
    AppStorage.setCurrentUser(u);
    AppStorage.setActiveOrgId(u.organizationId);
    router.replace('/(app)/dashboard');
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <View style={styles.logoBadge}>
          <MaterialCommunityIcons name="access-point-network" size={32} color="#ffffff" />
        </View>

        <Text style={styles.brandTitle}>ACME IoT</Text>
        <Text style={styles.brandSubtitle}>Intelligent Facility & Device Management</Text>

        {isSupabaseConfigured ? (
          <View style={styles.configuredBadge}>
            <MaterialCommunityIcons name="database-check" size={14} color="#15803d" />
            <Text style={styles.configuredBadgeText}>Connected to Supabase PostgreSQL</Text>
          </View>
        ) : (
          <View style={[styles.configuredBadge, { backgroundColor: '#f1f5f9' }]}>
            <MaterialCommunityIcons name="memory" size={14} color="#475569" />
            <Text style={[styles.configuredBadgeText, { color: '#475569' }]}>
              Local Sandbox / Demo Mode Active
            </Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBox}>
            <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#991b1b" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Input fields */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Corporate Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="name@company.com"
          />
        </View>

        <View style={styles.inputGroup}>
          <View style={styles.passwordRow}>
            <Text style={styles.inputLabel}>Password</Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/forgot-password')}>
              <Text style={styles.forgotLink}>Forgot password?</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••••••"
          />
        </View>

        <TouchableOpacity style={styles.loginBtn} onPress={handleLogin} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <>
              <Text style={styles.loginBtnText}>Sign In to Platform</Text>
              <MaterialCommunityIcons name="arrow-right" size={16} color="#ffffff" />
            </>
          )}
        </TouchableOpacity>

        {/* Quick Role Switcher for RBAC Inspection */}
        <View style={styles.quickAccessSection}>
          <View style={styles.dividerRow}>
            <View style={styles.line} />
            <Text style={styles.dividerText}>OR SELECT A ROLE PERSONA</Text>
            <View style={styles.line} />
          </View>

          <View style={styles.roleGrid}>
            {INITIAL_USERS.map((u) => (
              <TouchableOpacity
                key={u.id}
                style={styles.roleCard}
                onPress={() => handleQuickSelect(u)}
              >
                <View style={styles.roleHeader}>
                  <Text style={styles.roleTag}>{u.role.toUpperCase()}</Text>
                </View>
                <Text style={styles.roleName} numberOfLines={1}>
                  {u.fullName.split(' ')[0]}
                </Text>
                <Text style={styles.roleEmail} numberOfLines={1}>
                  {u.email}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f8fafc',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 460,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 4 },
  },
  logoBadge: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#4f46e5',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  brandSubtitle: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  configuredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#dcfce7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'center',
    marginBottom: 20,
  },
  configuredBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#15803d',
  },
  errorBox: {
    backgroundColor: '#fee2e2',
    padding: 10,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  errorText: {
    fontSize: 12,
    color: '#991b1b',
    fontWeight: '500',
  },
  inputGroup: {
    marginBottom: 16,
  },
  passwordRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  forgotLink: {
    fontSize: 12,
    color: '#4f46e5',
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
  },
  loginBtn: {
    backgroundColor: '#4f46e5',
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  loginBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  quickAccessSection: {
    marginTop: 24,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: '#e2e8f0',
  },
  dividerText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94a3b8',
    paddingHorizontal: 8,
    letterSpacing: 0.5,
  },
  roleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  roleCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 10,
  },
  roleHeader: {
    marginBottom: 4,
  },
  roleTag: {
    fontSize: 9,
    fontWeight: '700',
    color: '#4f46e5',
  },
  roleName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  roleEmail: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
  },
});
