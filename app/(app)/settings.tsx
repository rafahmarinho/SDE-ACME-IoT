import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  TextInput,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppStorage } from '../../src/services/storage';
import { AuthService, isSupabaseConfigured, StepUpStatus, TotpEnrollment } from '../../src/services/supabase';
import { DataGateway } from '../../src/services/dataGateway';
import { subscribeToSimulation } from '../../src/services/simulation';
import { ActionError } from '../../src/components/ActionError';
import {
  CONSENT_NOTICE_VERSION,
  CONSENT_PURPOSES,
  CONSENT_PURPOSE_TEXT,
  CONSENT_STATEMENT,
  ConsentPurpose,
} from '../../src/services/privacyNotice';

function currentConsentChoices(): Record<ConsentPurpose, boolean> {
  const decided = new Map(DataGateway.getConsents().map((c) => [c.purpose, c.granted]));
  return Object.fromEntries(CONSENT_PURPOSES.map((p) => [p, decided.get(p) === true])) as Record<ConsentPurpose, boolean>;
}

export default function SettingsScreen() {
  const router = useRouter();
  const [user, setUser] = useState(AppStorage.getCurrentUser());
  // SDE T178, T604: consent choices start unselected (opt-in) and reflect the recorded decisions.
  const [consentChoices, setConsentChoices] = useState<Record<ConsentPurpose, boolean>>(currentConsentChoices());
  const [consentMessage, setConsentMessage] = useState<{ text: string; success: boolean } | null>(null);
  const consentDirty = useRef(false);
  const [fullName, setFullName] = useState(user.fullName);
  const [newEmail, setNewEmail] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);

  const [stepUp, setStepUp] = useState<StepUpStatus | null>(null);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [mfaMessage, setMfaMessage] = useState<{ text: string; success: boolean } | null>(null);

  useEffect(() => {
    AuthService.getStepUpStatus().then(setStepUp);
    return subscribeToSimulation(() => {
      setUser(AppStorage.getCurrentUser());
      if (!consentDirty.current) setConsentChoices(currentConsentChoices());
    });
  }, []);

  // SDE T338: two-step verification (TOTP) protects team and integration data.
  const handleStartEnrollment = async () => {
    setMfaMessage(null);
    const result = await AuthService.startTotpEnrollment();
    if ('error' in result) setMfaMessage({ text: result.error, success: false });
    else setEnrollment(result);
  };

  const saveConsents = async (choices: Record<ConsentPurpose, boolean>) => {
    const result = await DataGateway.recordConsents(choices);
    consentDirty.current = false;
    setConsentMessage(result.success ? { text: 'Your choices were saved.', success: true } : { text: result.error, success: false });
    setConsentChoices(currentConsentChoices());
  };

  const handleAcceptConsents = () => saveConsents(consentChoices);
  const handleDeclineConsents = () =>
    saveConsents(Object.fromEntries(CONSENT_PURPOSES.map((p) => [p, false])) as Record<ConsentPurpose, boolean>);

  const handleConfirmCode = async () => {
    const result = enrollment
      ? await AuthService.confirmTotpEnrollment(enrollment.factorId, mfaCode)
      : await AuthService.verifyStepUp(mfaCode);
    setMfaMessage({ text: result.message, success: result.success });
    setMfaCode('');
    if (result.success) {
      setEnrollment(null);
      setShowSecret(false);
      setStepUp(await AuthService.getStepUpStatus());
    }
  };

  const handleLogout = async () => {
    await AuthService.signOut();
    router.replace('/(auth)/login');
  };

  // SDE T742: members keep their own personal information accurate (validated on the server).
  const handleSaveName = async () => {
    setProfileNotice(null);
    const result = await DataGateway.updateOwnProfile(fullName);
    setProfileError(result.success ? null : result.error);
    if (result.success) setProfileNotice('Name updated.');
    setUser(AppStorage.getCurrentUser());
  };

  const handleChangeEmail = async () => {
    setProfileNotice(null);
    const result = await AuthService.requestEmailChange(newEmail);
    setProfileError(result.success ? null : result.message);
    if (result.success) {
      setProfileNotice(result.message);
      setNewEmail('');
    }
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

        <ActionError message={profileError} />
        {profileNotice && <Text style={styles.profileNotice}>{profileNotice}</Text>}

        <Text style={styles.fieldLabel}>Full name</Text>
        <View style={styles.fieldRow}>
          <TextInput
            style={styles.fieldInput}
            value={fullName}
            onChangeText={setFullName}
            maxLength={100}
            autoCorrect={false}
            autoComplete="name"
          />
          <TouchableOpacity style={styles.fieldBtn} onPress={handleSaveName}>
            <Text style={styles.fieldBtnText}>Save</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.fieldLabel}>New e-mail address (confirmed by e-mail before it is used)</Text>
        <View style={styles.fieldRow}>
          <TextInput
            style={styles.fieldInput}
            value={newEmail}
            onChangeText={setNewEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            maxLength={254}
            placeholder="name@company.com"
          />
          <TouchableOpacity style={styles.fieldBtn} onPress={handleChangeEmail}>
            <Text style={styles.fieldBtnText}>Change</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Two-step verification (SDE T338) */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <MaterialCommunityIcons name="shield-key-outline" size={20} color="#4f46e5" />
          <Text style={styles.cardTitle}>Two-Step Verification</Text>
        </View>
        {mfaMessage && (
          <Text style={mfaMessage.success ? styles.profileNotice : styles.mfaError}>{mfaMessage.text}</Text>
        )}
        {!stepUp?.available ? (
          <Text style={styles.switchSub}>Available when the app is connected to the authentication service.</Text>
        ) : stepUp.enrolled && stepUp.verifiedSession ? (
          <Text style={styles.switchSub}>On. This session is verified with your authenticator app.</Text>
        ) : (
          <>
            <Text style={styles.switchSub}>
              {stepUp.enrolled
                ? 'Enter a code from your authenticator app to verify this session. Team and integration data require it.'
                : 'Team and integration data require a second factor. Add an authenticator app (TOTP) to your account.'}
            </Text>
            {!stepUp.enrolled && !enrollment && (
              <TouchableOpacity style={[styles.fieldBtn, styles.mfaStartBtn]} onPress={handleStartEnrollment}>
                <Text style={styles.fieldBtnText}>Enable two-step verification</Text>
              </TouchableOpacity>
            )}
            {enrollment && (
              <View style={styles.mfaEnrollBox}>
                <Image source={{ uri: enrollment.qrCodeUri }} style={styles.mfaQr} accessibilityLabel="QR code for your authenticator app" />
                <Text style={styles.fieldLabel}>Or enter this key in the app</Text>
                <View style={styles.fieldRow}>
                  <TextInput
                    style={styles.fieldInput}
                    value={enrollment.secret}
                    editable={false}
                    secureTextEntry={!showSecret}
                    autoCorrect={false}
                  />
                  <TouchableOpacity style={styles.fieldBtn} onPress={() => setShowSecret((v) => !v)}>
                    <Text style={styles.fieldBtnText}>{showSecret ? 'Hide' : 'Show'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            {(stepUp.enrolled || enrollment) && (
              <View style={[styles.fieldRow, { marginTop: 10 }]}>
                <TextInput
                  style={styles.fieldInput}
                  value={mfaCode}
                  onChangeText={setMfaCode}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoCorrect={false}
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                />
                <TouchableOpacity style={styles.fieldBtn} onPress={handleConfirmCode}>
                  <Text style={styles.fieldBtnText}>Verify</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
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

      {/* Privacy & consent (SDE T178, T604, T754) */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <MaterialCommunityIcons name="shield-account-outline" size={20} color="#4f46e5" />
          <Text style={styles.cardTitle}>Privacy & Consent</Text>
        </View>
        <Text style={styles.switchSub}>
          These e-mails are optional and only sent with your consent (notice version {CONSENT_NOTICE_VERSION}).
        </Text>
        <Text style={styles.consentLine}>Data used: {CONSENT_STATEMENT.categories}</Text>
        <Text style={styles.consentLine}>Retention: {CONSENT_STATEMENT.retention}</Text>
        <Text style={styles.consentLine}>Withdrawal: {CONSENT_STATEMENT.withdrawal}</Text>
        <Text style={styles.consentLine}>Third parties: {CONSENT_STATEMENT.thirdParties}</Text>
        {consentMessage && (
          <Text style={consentMessage.success ? styles.profileNotice : styles.mfaError}>{consentMessage.text}</Text>
        )}
        {CONSENT_PURPOSES.map((purpose) => {
          const decision = DataGateway.getConsents().find((c) => c.purpose === purpose);
          return (
            <View key={purpose} style={styles.switchRow}>
              <View style={{ flex: 1, marginRight: 10 }}>
                <Text style={styles.switchLabel}>{CONSENT_PURPOSE_TEXT[purpose].title} (optional)</Text>
                <Text style={styles.switchSub}>{CONSENT_PURPOSE_TEXT[purpose].detail}</Text>
                <Text style={styles.switchSub}>
                  {decision ? `${decision.granted ? 'Accepted' : 'Declined'} on ${new Date(decision.decidedAt).toLocaleString()}` : 'No decision yet'}
                </Text>
              </View>
              <Switch
                value={consentChoices[purpose]}
                onValueChange={(value) => {
                  consentDirty.current = true;
                  setConsentChoices((prev) => ({ ...prev, [purpose]: value }));
                }}
                trackColor={{ false: '#cbd5e1', true: '#c7d2fe' }}
                thumbColor={consentChoices[purpose] ? '#4f46e5' : '#f8fafc'}
              />
            </View>
          );
        })}
        <View style={[styles.fieldRow, { marginTop: 12 }]}>
          <TouchableOpacity style={[styles.fieldBtn, styles.consentBtn]} onPress={handleAcceptConsents}>
            <Text style={styles.fieldBtnText}>Accept selected</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.fieldBtn, styles.consentBtn, styles.declineBtn]} onPress={handleDeclineConsents}>
            <Text style={styles.declineBtnText}>Decline all</Text>
          </TouchableOpacity>
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
  profileNotice: {
    fontSize: 12,
    color: '#15803d',
    fontWeight: '600',
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginTop: 12,
    marginBottom: 6,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 8,
  },
  fieldInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0f172a',
    backgroundColor: '#ffffff',
  },
  fieldBtn: {
    backgroundColor: '#4f46e5',
    borderRadius: 8,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  fieldBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  mfaError: {
    fontSize: 12,
    color: '#b91c1c',
    fontWeight: '600',
    marginBottom: 8,
  },
  mfaStartBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    marginTop: 10,
  },
  mfaEnrollBox: {
    marginTop: 12,
  },
  mfaQr: {
    width: 180,
    height: 180,
    alignSelf: 'center',
  },
  consentLine: {
    fontSize: 11,
    color: '#475569',
    marginTop: 4,
  },
  consentBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
  },
  declineBtn: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  declineBtnText: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 12,
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
