import { supabase } from './supabase';

type ProfileRow = {
  id: string;
  username: string;
  email: string;
};

export type LocalSessionUser = {
  id: string;
  username: string;
};

function usernameToEmail(username: string): string {
  const normalized = username.trim().toLowerCase();
  return `${normalized}@moneytrack.local`;
}

function isEmail(value: string): boolean {
  return /\S+@\S+\.\S+/.test(value.trim());
}

function normalizeAuthErrorMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'Invalid username or password';
  if (lower.includes('already registered') || lower.includes('user already registered')) return 'Username already exists';
  if (lower.includes('email not confirmed')) return 'Account not active yet. Disable email confirmation in Supabase Auth settings for this MVP.';
  if (lower.includes('relation') && lower.includes('does not exist')) return 'Database schema is missing. Run supabase/schema.sql in Supabase SQL Editor.';
  return message;
}

function toSessionUser(profile: ProfileRow): LocalSessionUser {
  return { id: profile.id, username: profile.username };
}

function fallbackSessionUser(userId: string, preferred?: string): LocalSessionUser {
  return {
    id: userId,
    username: (preferred?.trim() || 'user').slice(0, 64),
  };
}

async function ensureProfile(userId: string, username: string, emailOverride?: string): Promise<ProfileRow> {
  const baseUsername = username.trim() || 'user';
  const email = (emailOverride?.trim() || usernameToEmail(baseUsername)).toLowerCase();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const safeUsername = attempt === 0 ? baseUsername : `${baseUsername}-${Math.floor(Math.random() * 9999)}`;
    const payload = {
      id: userId,
      username: safeUsername,
      email,
    };
    const { data, error } = await supabase.from('profiles').upsert(payload).select('id,username,email').single();
    if (!error && data) return data as ProfileRow;
    if (!error?.message.toLowerCase().includes('duplicate key value violates unique constraint')) {
      throw new Error(error?.message ?? 'Could not upsert profile');
    }
  }

  throw new Error('Could not create unique username profile');
}

async function getProfileById(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase.from('profiles').select('id,username,email').eq('id', userId).maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return (data as ProfileRow | null) ?? null;
}

export async function getLocalSessionUser(): Promise<LocalSessionUser | null> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) throw new Error(sessionError.message);
  if (!session?.user) return null;

  const username =
    (session.user.user_metadata?.username as string | undefined) ??
    session.user.email?.split('@')[0] ??
    'user';

  try {
    const profile = await getProfileById(session.user.id);
    if (profile) return toSessionUser(profile);
    const ensured = await ensureProfile(session.user.id, username, session.user.email ?? undefined);
    return toSessionUser(ensured);
  } catch {
    // Never block sign-in because profile row creation failed.
    return fallbackSessionUser(session.user.id, username);
  }
}

export async function signOutLocal(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

export async function registerLocal(email: string, password: string, username?: string): Promise<LocalSessionUser> {
  const normalizedEmail = email.trim().toLowerCase();
  const preferredUsername = username?.trim() || normalizedEmail.split('@')[0];
  if (!normalizedEmail || !password) {
    throw new Error('Email and password are required');
  }

  const { data, error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password,
    options: {
      data: { username: preferredUsername },
    },
  });

  if (error) throw new Error(normalizeAuthErrorMessage(error.message));
  if (!data.user) throw new Error('Could not create user');

  try {
    const profile = await ensureProfile(data.user.id, preferredUsername, normalizedEmail);
    return toSessionUser(profile);
  } catch {
    return fallbackSessionUser(data.user.id, preferredUsername);
  }
}

export async function loginLocal(identifier: string, password: string): Promise<LocalSessionUser> {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized || !password) {
    throw new Error('Email/username and password are required');
  }

  const email = isEmail(normalized) ? normalized : usernameToEmail(normalized);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) {
    throw new Error(normalizeAuthErrorMessage(error?.message ?? 'Invalid username or password'));
  }

  const recoveredUsername = (data.user.user_metadata?.username as string | undefined) ?? email.split('@')[0];
  try {
    let profile = await getProfileById(data.user.id);
    if (!profile) {
      profile = await ensureProfile(data.user.id, recoveredUsername, data.user.email ?? email);
    }
    return toSessionUser(profile);
  } catch {
    return fallbackSessionUser(data.user.id, recoveredUsername);
  }
}

export async function loginWithGoogle(redirectTo?: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: redirectTo ? { redirectTo } : undefined,
  });
  if (error) throw new Error(normalizeAuthErrorMessage(error.message));
}

export async function requestPasswordReset(email: string, redirectTo?: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!isEmail(normalizedEmail)) {
    throw new Error('Please enter a valid email');
  }
  const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, redirectTo ? { redirectTo } : undefined);
  if (error) throw new Error(normalizeAuthErrorMessage(error.message));
}

export async function completePasswordReset(nextPassword: string): Promise<void> {
  if (!nextPassword || nextPassword.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }
  const { error } = await supabase.auth.updateUser({ password: nextPassword });
  if (error) throw new Error(normalizeAuthErrorMessage(error.message));
}

export async function updateLocalUsername(userId: string, nextUsername: string): Promise<LocalSessionUser> {
  const normalized = nextUsername.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Username is required');
  }

  const { error } = await supabase.from('profiles').update({ username: nextUsername.trim() }).eq('id', userId);
  if (error) throw new Error(normalizeAuthErrorMessage(error.message));

  const profile = await getProfileById(userId);
  if (!profile) throw new Error('User not found');
  return toSessionUser(profile);
}

export async function updateLocalPassword(userId: string, currentPassword: string, nextPassword: string): Promise<void> {
  if (!nextPassword) {
    throw new Error('New password is required');
  }

  const profile = await getProfileById(userId);
  if (!profile) throw new Error('User not found');

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password: currentPassword,
  });
  if (signInError) throw new Error('Current password is incorrect');

  const { error: updateError } = await supabase.auth.updateUser({ password: nextPassword });
  if (updateError) throw new Error(normalizeAuthErrorMessage(updateError.message));
}

export async function deleteLocalAccount(userId: string, password: string): Promise<void> {
  const profile = await getProfileById(userId);
  if (!profile) {
    throw new Error('User not found');
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password,
  });
  if (signInError) throw new Error('Password is incorrect');

  // Anonymous clients cannot delete Auth user directly. We clear app data and sign out.
  await supabase.from('app_transactions').delete().eq('user_id', userId);
  await supabase.from('app_accounts').delete().eq('user_id', userId);
  await supabase.from('app_settings').delete().eq('user_id', userId);
  await supabase.from('profiles').delete().eq('id', userId);
  await signOutLocal();
}
