import { Account, AppSettings, Currency, Transaction } from '../types/finance';
import { supabase } from './supabase';

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

type JsonRow<T> = {
  user_id: string;
  data: T;
};

export async function loadTransactions(userId: string): Promise<Transaction[]> {
  const { data, error } = await supabase.from('app_transactions').select('data').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { data?: Transaction[] } | null;
  const items = row?.data ?? [];
  return [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function saveTransactions(userId: string, items: Transaction[]): Promise<void> {
  const payload: JsonRow<Transaction[]> = { user_id: userId, data: items };
  const { error } = await supabase.from('app_transactions').upsert(payload);
  if (error) throw new Error(error.message);
}

export async function loadAccounts(userId: string): Promise<Account[]> {
  const { data, error } = await supabase.from('app_accounts').select('data').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { data?: Account[] } | null;
  const items = row?.data ?? [];
  if (items.length === 0) return [defaultAccount];
  return items;
}

export async function saveAccounts(userId: string, items: Account[]): Promise<void> {
  const payload: JsonRow<Account[]> = { user_id: userId, data: items };
  const { error } = await supabase.from('app_accounts').upsert(payload);
  if (error) throw new Error(error.message);
}

export async function loadSettings(userId: string): Promise<AppSettings> {
  const { data, error } = await supabase.from('app_settings').select('data').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { data?: Partial<AppSettings> } | null;
  return { ...defaultSettings, ...(row?.data ?? {}) };
}

export async function saveSettings(userId: string, settings: AppSettings): Promise<void> {
  const payload: JsonRow<AppSettings> = { user_id: userId, data: settings };
  const { error } = await supabase.from('app_settings').upsert(payload);
  if (error) throw new Error(error.message);
}

export async function clearUserData(userId: string): Promise<void> {
  await Promise.all([
    supabase.from('app_transactions').delete().eq('user_id', userId),
    supabase.from('app_accounts').delete().eq('user_id', userId),
    supabase.from('app_settings').delete().eq('user_id', userId),
  ]);
}

export function formatAmount(amount: number, currency: Currency, locale: 'en-US' | 'vi-VN'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'VND' ? 0 : 2,
  }).format(amount);
}

