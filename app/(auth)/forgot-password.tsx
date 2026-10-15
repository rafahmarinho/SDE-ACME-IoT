import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AuthService } from '../../src/services/supabase';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; success: boolean } | null>(null);

  const handleReset = async () => {
    if (!email || !email.includes('@')) {
      setFeedback({ text: 'Please enter a valid corporate email address.', success: false });
      return;
    }
    setLoading(true);
    setFeedback(null);
    try {
      const res = await AuthService.resetPassword(email);
      setFeedback({ text: res.message, success: res.success });
    } catch (err: any) {
      setFeedback({ text: err.message || 'Recovery failed', success: false });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={18} color="#4f46e5" />
          <Text style={styles.backBtnText}>Back to Sign In</Text>
        </TouchableOpacity>

        <View style={styles.iconCircle}>
          <MaterialCommunityIcons name="lock-reset" size={30} color="#4f46e5" />
        </View>

        <Text style={styles.title}>Password Recovery</Text>
        <Text style={styles.subtitle}>
          Enter your registered work email to receive a cryptographically signed recovery token.
        </Text>

        {feedback && (
          <View
            style={[
              styles.feedbackBox,
              feedback.success ? styles.successBox : styles.errorBox,
            ]}
          >
            <MaterialCommunityIcons
              name={feedback.success ? 'check-circle-outline' : 'alert-circle-outline'}
              size={18}
              color={feedback.success ? '#15803d' : '#991b1b'}
            />
            <Text
              style={[
                styles.feedbackText,
                feedback.success ? styles.successText : styles.errorText,
              ]}
            >
              {feedback.text}
            </Text>
          </View>
        )}

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

        <TouchableOpacity style={styles.submitBtn} onPress={handleReset} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.submitBtnText}>Send Recovery Instructions</Text>
          )}
        </TouchableOpacity>
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
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 20,
  },
  backBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4f46e5',
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
