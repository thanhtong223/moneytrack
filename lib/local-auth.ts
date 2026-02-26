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

async function ensureProfile(userId: string, username: string): Promise<ProfileRow> {
  const email = usernameToEmail(username);
  const payload = {
    id: userId,
    username: username.trim(),
    email,
  };

  const { data, error } = await supabase.from('profiles').upsert(payload).select('id,username,email').single();
  if (error || !data) {
    throw new Error(error?.message ?? 'Could not upsert profile');
  }
  return data as ProfileRow;
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

  const profile = await getProfileById(session.user.id);
  if (profile) return toSessionUser(profile);

  const username =
    (session.user.user_metadata?.username as string | undefined) ??
    session.user.email?.replace(/@moneytrack\.local$/i, '') ??
    'user';
  const ensured = await ensureProfile(session.user.id, username);
  return toSessionUser(ensured);
}

export async function signOutLocal(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

export async function registerLocal(username: string, password: string): Promise<LocalSessionUser> {
  const normalized = username.trim().toLowerCase();
  if (!normalized || !password) {
    throw new Error('Username and password are required');
  }

  const email = usernameToEmail(normalized);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username: username.trim() },
    },
  });

  if (error) throw new Error(normalizeAuthErrorMessage(error.message));
  if (!data.user) throw new Error('Could not create user');

  const profile = await ensureProfile(data.user.id, username.trim());
  return toSessionUser(profile);
}

export async function loginLocal(username: string, password: string): Promise<LocalSessionUser> {
  const normalized = username.trim().toLowerCase();
  if (!normalized || !password) {
    throw new Error('Username and password are required');
  }

  const email = usernameToEmail(normalized);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) {
    throw new Error(normalizeAuthErrorMessage(error?.message ?? 'Invalid username or password'));
  }

  let profile = await getProfileById(data.user.id);
  if (!profile) {
    profile = await ensureProfile(data.user.id, username.trim());
  }
  return toSessionUser(profile);
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
