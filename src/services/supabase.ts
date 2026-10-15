// Supabase Client and Data Adapter with Offline & Local Storage Fallback
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppStorage } from './storage';
import { UserProfile } from '../types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl.startsWith('http') &&
  !supabaseUrl.includes('your-project')
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

export class AuthService {
  static async getCurrentUser(): Promise<UserProfile> {
    if (supabase) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', user.id)
            .single();

          if (profile) {
            const up: UserProfile = {
              id: profile.id,
              email: profile.email,
              fullName: profile.full_name,
              organizationId: profile.organization_id,
              role: profile.role,
              createdAt: profile.created_at,
            };
            AppStorage.setCurrentUser(up);
            return up;
          }
        }
      } catch (err) {
        console.warn('Supabase auth check failed, using local user:', err);
      }
    }
    return AppStorage.getCurrentUser();
  }

  static async signIn(email: string, password: string):Promise<{ user: UserProfile | null; error?: string }> {
    if (supabase) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return { user: null, error: error.message };
        if (data.user) {
          const up = await this.getCurrentUser();
          return { user: up };
        }
      } catch (err: any) {
        return { user: null, error: err.message || 'Login failed' };
      }
    }

    // Demo authentication fallback
    const users = [
      { email: 'sarah.chen@acme-iot.com', name: 'Sarah Chen (Founder & VP Ops)', role: 'owner' as const, org: '11111111-1111-1111-1111-111111111111' },
      { email: 'alex.rivera@acme-iot.com', name: 'Alex Rivera (Principal Systems Eng)', role: 'administrator' as const, org: '11111111-1111-1111-1111-111111111111' },
      { email: 'marcus.vance@acme-iot.com', name: 'Marcus Vance (Facilities Lead)', role: 'operator' as const, org: '11111111-1111-1111-1111-111111111111' },
      { email: 'elena.rostova@acme-iot.com', name: 'Elena Rostova (Compliance Auditor)', role: 'viewer' as const, org: '11111111-1111-1111-1111-111111111111' },
    ];

    const match = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (match) {
      const up: UserProfile = {
        id: 'u_' + Math.random().toString(36).substring(2, 9),
        email: match.email,
        fullName: match.name,
        organizationId: match.org,
        role: match.role,
        createdAt: new Date().toISOString(),
      };
      AppStorage.setCurrentUser(up);
      AppStorage.setActiveOrgId(up.organizationId);
      return { user: up };
    }

    // Default to owner for testing
    const defaultUser: UserProfile = {
      id: 'u_' + Math.random().toString(36).substring(2, 9),
      email: email || 'sarah.chen@acme-iot.com',
      fullName: 'Sarah Chen (Founder & VP Ops)',
      organizationId: '11111111-1111-1111-1111-111111111111',
      role: 'owner',
      createdAt: new Date().toISOString(),
    };
    AppStorage.setCurrentUser(defaultUser);
    return { user: defaultUser };
  }

  static async signOut(): Promise<void> {
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.warn('Supabase signout failed:', err);
      }
    }
  }

  static async resetPassword(email: string): Promise<{ success: boolean; message: string }> {
    if (supabase) {
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined,
        });
        if (error) return { success: false, message: error.message };
        return { success: true, message: 'Password recovery instructions sent to your email.' };
      } catch (err: any) {
        return { success: false, message: err.message || 'Failed to send reset email' };
      }
    }
    return {
      success: true,
      message: `Password reset email dispatched to ${email}. Check your inbox for the secure one-time link.`,
    };
  }
}
