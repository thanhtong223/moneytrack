import AsyncStorage from '@react-native-async-storage/async-storage';
import { Account, AppSettings, Currency, Transaction } from '../types/finance';

const TX_KEY = 'finance-mvp-transactions';
const ACCOUNT_KEY = 'finance-mvp-accounts';
const SETTINGS_KEY = 'finance-mvp-settings';

const defaultAccount: Account = {
  id: 'acc-cash',
  name: 'Cash Wallet',
  currency: 'VND',
  createdAt: new Date().toISOString(),
};

const defaultSettings: AppSettings = {
  language: 'vi',
  defaultCurrency: 'VND',
  theme: 'dark',
  onboardingCompleted: false,
  defaultAccountId: defaultAccount.id,
};

function scope(key: string, userId: string): string {
  return `${key}:${userId}`;
}

export async function loadTransactions(userId: string): Promise<Transaction[]> {
  const raw = await AsyncStorage.getItem(scope(TX_KEY, userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Transaction[];
    return parsed.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch {
    return [];
  }
}

export async function saveTransactions(userId: string, items: Transaction[]): Promise<void> {
  await AsyncStorage.setItem(scope(TX_KEY, userId), JSON.stringify(items));
}

export async function loadAccounts(userId: string): Promise<Account[]> {
  const raw = await AsyncStorage.getItem(scope(ACCOUNT_KEY, userId));
  if (!raw) return [defaultAccount];
  try {
    const parsed = JSON.parse(raw) as Account[];
    if (parsed.length === 0) return [defaultAccount];
    return parsed;
  } catch {
    return [defaultAccount];
  }
}

export async function saveAccounts(userId: string, items: Account[]): Promise<void> {
  await AsyncStorage.setItem(scope(ACCOUNT_KEY, userId), JSON.stringify(items));
}

export async function loadSettings(userId: string): Promise<AppSettings> {
  const raw = await AsyncStorage.getItem(scope(SETTINGS_KEY, userId));
  if (!raw) return defaultSettings;
  try {
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return defaultSettings;
  }
}

export async function saveSettings(userId: string, settings: AppSettings): Promise<void> {
  await AsyncStorage.setItem(scope(SETTINGS_KEY, userId), JSON.stringify(settings));
}

export async function clearUserData(userId: string): Promise<void> {
  await AsyncStorage.multiRemove([
    scope(TX_KEY, userId),
    scope(ACCOUNT_KEY, userId),
    scope(SETTINGS_KEY, userId),
  ]);
}

export function formatAmount(amount: number, currency: Currency, locale: 'en-US' | 'vi-VN'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'VND' ? 0 : 2,
  }).format(amount);
}
