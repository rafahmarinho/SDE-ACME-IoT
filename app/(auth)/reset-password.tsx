import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AuthService } from '../../src/services/supabase';
import { PASSWORD_MIN_LENGTH, passwordPolicyViolations } from '../../src/services/securityCore';

// SDE T2, T143: target of the recovery link e-mailed by Supabase Auth. The link opens a short recovery
// session; the new password must meet the minimum standard, the user may end every other session,
// and then signs in again with the new password.
export default function ResetPasswordScreen() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [linkValid, setLinkValid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [endOtherSessions, setEndOtherSessions] = useState(true);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; success: boolean } | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');

  useEffect(() => {
    let active = true;
    AuthService.hasRecoverySession().then((valid) => {
      if (!active) return;
      setLinkValid(valid);
      setChecking(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async () => {
    setFeedback(null);
    const issues = passwordPolicyViolations(password);
    if (issues.length > 0) {
      setFeedback({ text: issues.join(' '), success: false });
      return;
    }
    if (password !== confirmation) {
      setFeedback({ text: 'The two passwords do not match.', success: false });
      return;
    }
    setLoading(true);
    const result = await AuthService.completePasswordReset(password, endOtherSessions, mfaRequired ? mfaCode : undefined);
    setLoading(false);
    setFeedback({ text: result.message, success: result.success });
    if (result.mfaRequired) {
      setMfaRequired(true);
      setMfaCode('');
    }
    if (result.success) {
      setPassword('');
      setConfirmation('');
      setTimeout(() => router.replace('/(auth)/login'), 1500);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <MaterialCommunityIcons name="lock-reset" size={30} color="#4f46e5" />
        </View>
        <Text style={styles.title}>Choose a New Password</Text>
        <Text style={styles.subtitle}>
          At least {PASSWORD_MIN_LENGTH} characters mixing upper-case letters, lower-case letters and digits.
        </Text>

        {feedback && (
          <View style={[styles.feedbackBox, feedback.success ? styles.successBox : styles.errorBox]}>
            <MaterialCommunityIcons
              name={feedback.success ? 'check-circle-outline' : 'alert-circle-outline'}
              size={18}
              color={feedback.success ? '#15803d' : '#991b1b'}
            />
            <Text style={[styles.feedbackText, feedback.success ? styles.successText : styles.errorText]}>{feedback.text}</Text>
          </View>
        )}

        {checking ? (
          <ActivityIndicator color="#4f46e5" />
        ) : !linkValid ? (
          <>
            <Text style={styles.subtitle}>This recovery link is invalid or has expired. Request a new one.</Text>
            <TouchableOpacity style={styles.submitBtn} onPress={() => router.replace('/(auth)/forgot-password')}>
              <Text style={styles.submitBtnText}>Request a New Link</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>New password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCorrect={false}
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                maxLength={72}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Repeat the new password</Text>
              <TextInput
                style={styles.input}
                value={confirmation}
                onChangeText={setConfirmation}
                secureTextEntry
                autoCorrect={false}
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                maxLength={72}
              />
            </View>
            {mfaRequired && (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Code from your authenticator app</Text>
                <TextInput
                  style={styles.input}
                  value={mfaCode}
                  onChangeText={setMfaCode}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoCorrect={false}
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                />
              </View>
            )}
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Sign out of all other devices and sessions</Text>
              <Switch
                value={endOtherSessions}
                onValueChange={setEndOtherSessions}
                trackColor={{ false: '#cbd5e1', true: '#c7d2fe' }}
                thumbColor={endOtherSessions ? '#4f46e5' : '#f8fafc'}
              />
            </View>
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={loading}>
              {loading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.submitBtnText}>Save New Password</Text>}
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    maxWidth: 440,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 15,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#eef2ff',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20,
    lineHeight: 18,
  },
  feedbackBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  successBox: {
    backgroundColor: '#dcfce7',
  },
  errorBox: {
    backgroundColor: '#fee2e2',
  },
  feedbackText: {
    fontSize: 12,
    flex: 1,
    fontWeight: '500',
  },
  successText: {
    color: '#15803d',
  },
  errorText: {
    color: '#991b1b',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  switchLabel: {
    flex: 1,
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  submitBtn: {
    backgroundColor: '#4f46e5',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  submitBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
