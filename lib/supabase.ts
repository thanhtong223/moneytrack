import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export function hasSupabaseConfig(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

if (!hasSupabaseConfig()) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Required for OAuth/password-recovery on web callback URLs.
    detectSessionInUrl: Platform.OS === 'web',
  },
});
