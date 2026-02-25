import AsyncStorage from '@react-native-async-storage/async-storage';

type LocalUserRecord = {
  id: string;
  username: string;
  password: string;
};

export type LocalSessionUser = {
  id: string;
  username: string;
};

const USERS_KEY = 'moneytrack-local-users';
const SESSION_KEY = 'moneytrack-local-session';

async function loadUsers(): Promise<LocalUserRecord[]> {
  const raw = await AsyncStorage.getItem(USERS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as LocalUserRecord[];
  } catch {
    return [];
  }
}

async function saveUsers(users: LocalUserRecord[]): Promise<void> {
  await AsyncStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function toSessionUser(user: LocalUserRecord): LocalSessionUser {
  return { id: user.id, username: user.username };
}

export async function getLocalSessionUser(): Promise<LocalSessionUser | null> {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LocalSessionUser;
  } catch {
    return null;
  }
}

export async function signOutLocal(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_KEY);
}

export async function registerLocal(username: string, password: string): Promise<LocalSessionUser> {
  const users = await loadUsers();
  const normalized = username.trim().toLowerCase();

  if (!normalized || !password) {
    throw new Error('Username and password are required');
  }

  if (users.some((u) => u.username.toLowerCase() === normalized)) {
    throw new Error('Username already exists');
  }

  const user: LocalUserRecord = {
    id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    username: username.trim(),
    password,
  };

  users.push(user);
  await saveUsers(users);

  const sessionUser = toSessionUser(user);
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
  return sessionUser;
}

export async function loginLocal(username: string, password: string): Promise<LocalSessionUser> {
  const users = await loadUsers();
  const normalized = username.trim().toLowerCase();

  const found = users.find((u) => u.username.toLowerCase() === normalized);
  if (!found || found.password !== password) {
    throw new Error('Invalid username or password');
  }

  const sessionUser = toSessionUser(found);
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
  return sessionUser;
}

export async function updateLocalUsername(userId: string, nextUsername: string): Promise<LocalSessionUser> {
  const users = await loadUsers();
  const normalized = nextUsername.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Username is required');
  }

  const idx = users.findIndex((u) => u.id === userId);
  if (idx < 0) {
    throw new Error('User not found');
  }

  if (users.some((u) => u.id !== userId && u.username.toLowerCase() === normalized)) {
    throw new Error('Username already exists');
  }

  users[idx] = { ...users[idx], username: nextUsername.trim() };
  await saveUsers(users);

  const sessionUser = toSessionUser(users[idx]);
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
  return sessionUser;
}

export async function updateLocalPassword(userId: string, currentPassword: string, nextPassword: string): Promise<void> {
  if (!nextPassword) {
    throw new Error('New password is required');
  }

  const users = await loadUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx < 0) {
    throw new Error('User not found');
  }

  if (users[idx].password !== currentPassword) {
    throw new Error('Current password is incorrect');
  }

  users[idx] = { ...users[idx], password: nextPassword };
  await saveUsers(users);
}

export async function deleteLocalAccount(userId: string, password: string): Promise<void> {
  const users = await loadUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx < 0) {
    throw new Error('User not found');
  }

  if (users[idx].password !== password) {
    throw new Error('Password is incorrect');
  }

  const nextUsers = users.filter((u) => u.id !== userId);
  await saveUsers(nextUsers);
  await AsyncStorage.removeItem(SESSION_KEY);
}
