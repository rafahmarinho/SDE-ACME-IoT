// Supabase Client and Authentication Service
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppStorage } from './storage';
import { SimulationEngine } from './simulation';
import { UserProfile } from '../types';
import { INITIAL_USERS } from '../mock/initialData';
import { isDemoModeEnabled, isSecureBackendUrl, isServerDataMode } from '../config/runtime';
import { isUserRole, passwordPolicyViolations } from './securityCore';
import { clearPublicReferences } from './security';
import { configureApiClient } from './apiClient';
import { DataGateway } from './dataGateway';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// SDE T21, T146, T558, T2663: TLS-only backend (see src/config/runtime.ts).
export { isSecureBackendUrl };

export const isSupabaseConfigured = isServerDataMode();

// SDE T148, T1468, T295: the Supabase session (access and refresh tokens) is kept in memory only.
// Nothing is written to localStorage or sessionStorage, so another script or user of the browser
// cannot read it at rest; reloading the page requires signing in again.
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

// Server mode: the API receives the caller's access token; a 401 from the API (session revoked,
// expired or privileges changed) ends the local session so the user signs in again (SDE T20).
let endingSession = false;
if (supabase) {
  const client = supabase;
  configureApiClient({
    getAccessToken: async () => {
      const { data } = await client.auth.getSession();
      return data.session?.access_token ?? null;
    },
    onUnauthorized: () => {
      if (endingSession) return;
      endingSession = true;
      void AuthService.signOut().finally(() => {
        endingSession = false;
      });
    },
  });
}

// SDE T8: a single generic message for authentication failures (no account enumeration).
export const GENERIC_AUTH_ERROR = 'Invalid email or password.';

export interface SignInResult {
  user: UserProfile | null;
  error?: string;
  // SDE T338: the password was accepted and the member must now enter a code from their authenticator.
  mfaRequired?: boolean;
}

export interface StepUpStatus {
  available: boolean;
  enrolled: boolean;
  verifiedSession: boolean;
}

export interface TotpEnrollment {
  factorId: string;
  qrCodeUri: string;
  secret: string;
}

// SDE T1539: ask the server to send Clear-Site-Data for this origin (browsers only).
async function requestClearSiteData(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof fetch !== 'function') return;
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    // Best effort: the client-side session and cached data were already wiped.
  }
}

export class AuthService {
  // Loads role and organization of an authenticated Supabase user. Fails closed: no profile, no session.
  private static async loadSupabaseProfile(userId: string): Promise<UserProfile | null> {
    if (!supabase) return null;
    try {
      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('id, email, full_name, organization_id, role, created_at')
        .eq('id', userId)
        .single();
      if (error || !profile || !isUserRole(profile.role)) return null;
      return {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        organizationId: profile.organization_id,
        role: profile.role,
        createdAt: profile.created_at,
      };
    } catch {
      console.warn('Supabase profile lookup failed');
      return null;
    }
  }

  // SDE T20, T26: every login starts from a clean app session and records that a session is open.
  private static startSession(profile: UserProfile): void {
    const previousSessionOpen = AppStorage.hasUnclosedSession();
    AppStorage.clearAppData();
    AppStorage.setCurrentUser(profile);
    AppStorage.setActiveOrgId(profile.organizationId);
    AppStorage.setLogoutReminder(previousSessionOpen);
    AppStorage.markSessionOpen();
  }

  static async signIn(email: string, password: string): Promise<SignInResult> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) return { user: null, error: GENERIC_AUTH_ERROR };

    if (supabase) {
      try {
        // SDE T20: a session that existed before this authentication is never reused; Supabase issues
        // a new session (new session id and tokens) for every successful sign-in.
        await supabase.auth.signOut({ scope: 'local' });
        const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (error || !data.user) return { user: null, error: GENERIC_AUTH_ERROR };
        // SDE T338: members who enabled two-step verification finish signing in with a TOTP code.
        const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (!level.error && level.data.nextLevel === 'aal2' && level.data.currentLevel !== 'aal2') {
          return { user: null, mfaRequired: true };
        }
        return await this.completeSupabaseSignIn(data.user.id);
      } catch {
        return { user: null, error: 'Sign-in is temporarily unavailable. Please try again.' };
      }
    }

    // Demo personas exist only in builds that opt in with EXPO_PUBLIC_DEMO_MODE=true.
    if (isDemoModeEnabled()) {
      return this.signInDemoPersona(normalizedEmail);
    }

    return { user: null, error: 'Authentication service is not configured.' };
  }

  private static async completeSupabaseSignIn(userId: string): Promise<SignInResult> {
    const profile = await this.loadSupabaseProfile(userId);
    if (!profile) {
      await supabase?.auth.signOut({ scope: 'local' });
      AppStorage.clearAll();
      return { user: null, error: 'Your account is not assigned to an organization. Contact an administrator.' };
    }
    this.startSession(profile);
    return { user: profile };
  }

  // Verifies a code from the member's verified TOTP factor; the session becomes aal2 (new tokens).
  private static async verifyTotpCode(code: string): Promise<boolean> {
    const digits = code.trim();
    if (!supabase || !/^\d{6}$/.test(digits)) return false;
    const factors = await supabase.auth.mfa.listFactors();
    const factor = factors.data?.totp?.find((f) => f.status === 'verified');
    if (!factor) return false;
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: digits });
    return !error;
  }

  // SDE T338: second step of the sign-in for members with two-step verification.
  static async verifySignInCode(code: string): Promise<SignInResult> {
    if (!supabase) return { user: null, error: GENERIC_AUTH_ERROR };
    try {
      if (!(await this.verifyTotpCode(code))) return { user: null, mfaRequired: true, error: 'The verification code is not valid.' };
      const { data } = await supabase.auth.getUser();
      if (!data.user) return { user: null, error: GENERIC_AUTH_ERROR };
      return await this.completeSupabaseSignIn(data.user.id);
    } catch {
      return { user: null, error: 'Sign-in is temporarily unavailable. Please try again.' };
    }
  }

  static async getStepUpStatus(): Promise<StepUpStatus> {
    if (!supabase) return { available: false, enrolled: false, verifiedSession: false };
    try {
      const [level, factors] = await Promise.all([supabase.auth.mfa.getAuthenticatorAssuranceLevel(), supabase.auth.mfa.listFactors()]);
      return {
        available: true,
        enrolled: Boolean(factors.data?.totp?.some((f) => f.status === 'verified')),
        verifiedSession: level.data?.currentLevel === 'aal2',
      };
    } catch {
      return { available: false, enrolled: false, verifiedSession: false };
    }
  }

  // Starts TOTP enrollment: the QR code and key are shown once, never stored or logged.
  static async startTotpEnrollment(): Promise<TotpEnrollment | { error: string }> {
    if (!supabase) return { error: 'Two-step verification requires the authentication service.' };
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      if (error || !data) return { error: 'Two-step verification could not be started. Please try again.' };
      const qr = data.totp.qr_code;
      return {
        factorId: data.id,
        qrCodeUri: qr.startsWith('data:') ? qr : `data:image/svg+xml;utf-8,${encodeURIComponent(qr)}`,
        secret: data.totp.secret,
      };
    } catch {
      return { error: 'Two-step verification could not be started. Please try again.' };
    }
  }

  // Confirms the new factor with a first code; the current session is upgraded to aal2.
  static async confirmTotpEnrollment(factorId: string, code: string): Promise<{ success: boolean; message: string }> {
    if (!supabase || !/^\d{6}$/.test(code.trim())) return { success: false, message: 'Enter the 6-digit code from your authenticator app.' };
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
      if (error) return { success: false, message: 'The verification code is not valid.' };
      await DataGateway.refresh();
      return { success: true, message: 'Two-step verification is on for your account.' };
    } catch {
      return { success: false, message: 'The verification code could not be checked. Please try again.' };
    }
  }

  // Step-up for the current session (e.g. before managing the team or integrations).
  static async verifyStepUp(code: string): Promise<{ success: boolean; message: string }> {
    try {
      if (!(await this.verifyTotpCode(code))) return { success: false, message: 'The verification code is not valid.' };
      await DataGateway.refresh();
      return { success: true, message: 'Session verified with your second factor.' };
    } catch {
      return { success: false, message: 'The verification code could not be checked. Please try again.' };
    }
  }

  // Demo-only persona sign-in. Refused when a real backend is configured or demo mode is off;
  // unknown e-mails are rejected and nobody is defaulted to a role.
  static signInDemoPersona(email: string): SignInResult {
    if (supabase || !isDemoModeEnabled()) return { user: null, error: GENERIC_AUTH_ERROR };
    const persona = INITIAL_USERS.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!persona) return { user: null, error: GENERIC_AUTH_ERROR };
    this.startSession(persona);
    return { user: persona };
  }

  // SDE T16, T338: resolves the session for the route guard (verified by the server when
  // Supabase is configured). Returns null when the user must sign in.
  static async restoreSession(): Promise<UserProfile | null> {
    if (supabase) {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error || !data.user) {
          AppStorage.clearAll();
          return null;
        }
        // SDE T338: a sign-in whose second-factor step was not completed never becomes an app session.
        const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (level.error || (level.data.nextLevel === 'aal2' && level.data.currentLevel !== 'aal2')) {
          await supabase.auth.signOut({ scope: 'local' });
          AppStorage.clearAll();
          return null;
        }
        const stored = AppStorage.getSessionUser();
        if (stored && stored.id === data.user.id) return stored;
        const profile = await this.loadSupabaseProfile(data.user.id);
        if (!profile) {
          await this.signOut();
          return null;
        }
        AppStorage.setCurrentUser(profile);
        AppStorage.setActiveOrgId(profile.organizationId);
        return profile;
      } catch {
        return null;
      }
    }
    if (isDemoModeEnabled()) return AppStorage.getSessionUser();
    AppStorage.clearAppData();
    return null;
  }

  // SDE T164: wipe client data when the server ends the session (sign-out elsewhere,
  // refresh-token failure or expiry).
  static onSessionEnded(listener: () => void): () => void {
    if (!supabase) return () => {};
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        SimulationEngine.stop();
        DataGateway.reset();
        AppStorage.clearAll();
        listener();
      }
    });
    return () => data.subscription.unsubscribe();
  }

  // SDE T26, T164, T1539: logout revokes the Supabase session, stops session processes, wipes
  // every client-side copy of the session and cached data, and asks the browser to clear site data.
  static async signOut(): Promise<void> {
    SimulationEngine.stop();
    DataGateway.reset();
    clearPublicReferences();
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
        console.warn('Supabase signout failed');
      }
    }
    AppStorage.clearAll();
    AppStorage.markSessionClosed();
    await requestClearSiteData();
  }

  // SDE T742: e-mail changes go through Supabase Auth, which confirms the new address before it is
  // used; a database trigger then propagates it to the profile (one profile per address).
  static async requestEmailChange(newEmail: string): Promise<{ success: boolean; message: string }> {
    const email = newEmail.trim().toLowerCase();
    if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { success: false, message: 'Enter a valid e-mail address.' };
    }
    if (!supabase) return { success: false, message: 'E-mail changes require the authentication service.' };
    try {
      const { error } = await supabase.auth.updateUser({ email });
      if (error) return { success: false, message: 'The e-mail address could not be changed. Please try again.' };
      return { success: true, message: 'Confirm the change from the messages sent to your current and new addresses.' };
    } catch {
      return { success: false, message: 'The e-mail address could not be changed. Please try again.' };
    }
  }

  // SDE T2: the same confirmation is shown whether or not the address has an account (no account
  // enumeration). Supabase Auth sends a single-use link that expires (supabase/config.toml) and rate
  // limits the requests on the server.
  static async resetPassword(email: string): Promise<{ success: boolean; message: string }> {
    if (supabase) {
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
          redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined,
        });
        if (error && error.status === 429) {
          return { success: false, message: 'Too many recovery requests. Please wait before trying again.' };
        }
        if (error) return { success: false, message: 'Password recovery is temporarily unavailable. Please try again.' };
        return { success: true, message: PASSWORD_RESET_CONFIRMATION };
      } catch {
        return { success: false, message: 'Password recovery is temporarily unavailable. Please try again.' };
      }
    }
    if (isDemoModeEnabled()) {
      return { success: true, message: 'Demo mode: no e-mail is sent because no authentication backend is configured.' };
    }
    return { success: false, message: 'Password recovery is not available: authentication service is not configured.' };
  }

  // True when the page was opened from a valid recovery link (Supabase validated it and opened a
  // short recovery session) or by a signed-in user.
  static async hasRecoverySession(): Promise<boolean> {
    if (!supabase) return false;
    try {
      const { data } = await supabase.auth.getSession();
      return Boolean(data.session);
    } catch {
      return false;
    }
  }

  // SDE T2, T143: sets the new password (minimum standard checked here and by Supabase Auth), offers
  // to end every other active session, then ends the recovery session so the user signs in again.
  static async completePasswordReset(
    newPassword: string,
    endOtherSessions: boolean,
    totpCode?: string
  ): Promise<{ success: boolean; message: string; mfaRequired?: boolean }> {
    if (!supabase) return { success: false, message: 'Password recovery is not available: authentication service is not configured.' };
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return { success: false, message: 'This recovery link is invalid or has expired. Request a new one.' };
      const issues = passwordPolicyViolations(newPassword, { email: data.session.user.email ?? '' });
      if (issues.length > 0) return { success: false, message: issues.join(' ') };
      // SDE T338: members with a verified second factor confirm it first (a recovery session is only aal1
      // and Supabase Auth refuses the password change until the factor is verified).
      const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!level.error && level.data.nextLevel === 'aal2' && level.data.currentLevel !== 'aal2') {
        if (!totpCode) return { success: false, mfaRequired: true, message: 'Enter the code from your authenticator app to continue.' };
        if (!(await this.verifyTotpCode(totpCode))) return { success: false, mfaRequired: true, message: 'The verification code is not valid.' };
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { success: false, message: 'The password could not be changed. Request a new recovery link.' };
      if (endOtherSessions) await supabase.auth.signOut({ scope: 'others' });
      await supabase.auth.signOut({ scope: 'local' });
      AppStorage.clearAll();
      return { success: true, message: 'Your password was changed. Sign in with the new password.' };
    } catch {
      return { success: false, message: 'The password could not be changed. Request a new recovery link.' };
    }
  }
}

export const PASSWORD_RESET_CONFIRMATION =
  'If an account exists for this address, an e-mail with a single-use link was sent. The link expires in one hour.';
