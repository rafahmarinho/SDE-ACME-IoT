// Runtime feature flags.
// EXPO_PUBLIC_* values are inlined at build time by babel-preset-expo, so they must be
// referenced literally as process.env.EXPO_PUBLIC_... (no destructuring).

// SDE T49, T61, T2349: demo personas, the persona/tenant switcher and "Reset Demo" are
// development aids. They are disabled unless a non-production build opts in explicitly.
export function isDemoModeEnabled(): boolean {
  return process.env.EXPO_PUBLIC_DEMO_MODE === 'true';
}

// SDE T21, T146, T558, T2663: the backend is only reached over TLS. Plain http is accepted
// solely for a local stack running on the developer machine.
export function isSecureBackendUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

// SDE T17, T145, T378: server mode. When a Supabase backend is configured, the authenticated /api
// functions are the source of truth for every data read and write, and the client keeps tenant data
// in memory only. Without a backend only the opt-in local demo exists.
export function isServerDataMode(): boolean {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  return Boolean(url && anonKey && isSecureBackendUrl(url) && !url.includes('your-project'));
}
