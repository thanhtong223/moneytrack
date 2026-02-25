import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  LayoutAnimation,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { UIManager } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import Svg, { Circle } from 'react-native-svg';

import { fetchUsdVndRate, FxRate } from './lib/exchange';
import { pickReceiptFile, ReceiptFile, takeReceiptPhoto, uploadReceiptImage } from './lib/image';
import { t } from './lib/i18n';
import { extractReceiptText, hasLLMConfig, normalizeTextToTransaction, transcribeAudio } from './lib/llm';
import { parseTransactionInput } from './lib/parser';
import {
  formatAmount,
  clearUserData,
  loadAccounts,
  loadSettings,
  loadTransactions,
  saveAccounts,
  saveSettings,
  saveTransactions,
} from './lib/storage';
import {
  deleteLocalAccount,
  getLocalSessionUser,
  LocalSessionUser,
  loginLocal,
  registerLocal,
  signOutLocal,
  updateLocalPassword,
  updateLocalUsername,
} from './lib/local-auth';
import { startRecording, stopRecording } from './lib/voice';
import { Account, AppSettings, Currency, Language, ThemeMode, Transaction, TransactionType } from './types/finance';

type Tab = 'home' | 'transactions' | 'add' | 'wallets' | 'accounts';
type AddMode = 'manual' | 'ai';
type AuthMode = 'login' | 'register';
type PeriodFilter = 'day' | 'week' | 'month' | 'year' | 'custom';

const dark = {
  bg: '#06080f',
  card: 'rgba(22,28,40,0.72)',
  text: '#f6f8ff',
  sub: '#93a0ba',
  border: 'rgba(146,176,221,0.24)',
  accent: '#2cd37a',
  danger: '#ff7287',
  muted: 'rgba(12,17,28,0.84)',
  overlay: 'rgba(7,10,17,0.74)',
};

const light = {
  bg: '#edf2f8',
  card: 'rgba(255,255,255,0.78)',
  text: '#131b2c',
  sub: '#6a7892',
  border: 'rgba(150,173,206,0.3)',
  accent: '#10b969',
  danger: '#db3f5d',
  muted: 'rgba(243,248,255,0.9)',
  overlay: 'rgba(238,244,253,0.76)',
};

const DONUT_COLORS = ['#2CD37A', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4'];

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function localeFromLanguage(language: Language): 'en-US' | 'vi-VN' {
  return language === 'vi' ? 'vi-VN' : 'en-US';
}

function groupedByDate(items: Transaction[]): Array<[string, Transaction[]]> {
  const map = new Map<string, Transaction[]>();
  for (const tx of items) {
    const list = map.get(tx.date) ?? [];
    list.push(tx);
    map.set(tx.date, list);
  }
  return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function App() {
  const [user, setUser] = useState<LocalSessionUser | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [guestLanguage, setGuestLanguage] = useState<Language>('vi');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [tab, setTab] = useState<Tab>('home');
  const [addMode, setAddMode] = useState<AddMode>('manual');

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    language: 'vi',
    defaultCurrency: 'VND',
    theme: 'dark',
    onboardingCompleted: false,
  });
  const [fxRate, setFxRate] = useState<FxRate | null>(null);

  const [manualType, setManualType] = useState<TransactionType>('expense');
  const [manualRaw, setManualRaw] = useState('');
  const [aiType, setAiType] = useState<TransactionType>('expense');
  const [aiRaw, setAiRaw] = useState('');
  const [pendingReceipt, setPendingReceipt] = useState<ReceiptFile | null>(null);

  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [loading, setLoading] = useState(false);

  const [newAccountName, setNewAccountName] = useState('');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [receiptViewerUri, setReceiptViewerUri] = useState<string | null>(null);
  const [txtContent, setTxtContent] = useState('');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [datePickerTarget, setDatePickerTarget] = useState<'from' | 'to' | 'entry'>('from');
  const [datePickerValue, setDatePickerValue] = useState(new Date());
  const [datePickerDraft, setDatePickerDraft] = useState(new Date());

  const [profileUsername, setProfileUsername] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [accountPanel, setAccountPanel] = useState<'profile' | 'theme' | 'language' | null>(null);

  const tabAnim = useRef(new Animated.Value(1)).current;
  const waveAnim = useRef(new Animated.Value(0)).current;

  const language = user ? settings.language : guestLanguage;
  const locale = localeFromLanguage(language);
  const theme = settings.theme;
  const palette = theme === 'dark' ? dark : light;
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const selectedAccountId = settings.defaultAccountId ?? accounts[0]?.id;
  const usdToVnd = fxRate?.usdToVnd ?? 25500;
  const accountTransactions = useMemo(
    () => (selectedAccountId ? transactions.filter((tx) => tx.accountId === selectedAccountId) : transactions),
    [transactions, selectedAccountId],
  );

  useEffect(() => {
    getLocalSessionUser().then(setUser);
  }, []);

  useEffect(() => {
    setProfileUsername(user?.username ?? '');
  }, [user?.username]);

  useEffect(() => {
    async function bootstrapForUser() {
      if (!user) {
        setTransactions([]);
        setAccounts([]);
        return;
      }

      const [tx, ac, st, fx] = await Promise.all([
        loadTransactions(user.id),
        loadAccounts(user.id),
        loadSettings(user.id),
        fetchUsdVndRate(),
      ]);

      setTransactions(tx);
      setAccounts(ac);
      setSettings((prev) => ({ ...prev, ...st, defaultAccountId: st.defaultAccountId ?? ac[0]?.id }));
      setFxRate(fx);
    }

    bootstrapForUser();
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    saveTransactions(user.id, transactions);
  }, [transactions, user?.id]);

  useEffect(() => {
    if (!user || accounts.length === 0) return;
    saveAccounts(user.id, accounts);
  }, [accounts, user?.id]);

  useEffect(() => {
    if (!user) return;
    saveSettings(user.id, settings);
  }, [settings, user?.id]);

  useEffect(() => {
    async function readTxt() {
      if (!selectedTx?.receiptUri || selectedTx.receiptType !== 'text') {
        setTxtContent('');
        return;
      }
      try {
        const res = await fetch(selectedTx.receiptUri);
        setTxtContent(await res.text());
      } catch {
        setTxtContent('Cannot read TXT file.');
      }
    }
    readTxt();
  }, [selectedTx]);

  useEffect(() => {
    tabAnim.setValue(0);
    Animated.spring(tabAnim, {
      toValue: 1,
      speed: 18,
      bounciness: 6,
      useNativeDriver: true,
    }).start();
  }, [tab, tabAnim]);

  useEffect(() => {
    if (!recording) {
      waveAnim.stopAnimation();
      waveAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(waveAnim, {
        toValue: 1,
        duration: 1100,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [recording, waveAnim]);

  function toMainCurrency(amount: number, currency: Currency): number {
    if (currency === settings.defaultCurrency) return amount;
    if (currency === 'USD' && settings.defaultCurrency === 'VND') return amount * usdToVnd;
    if (currency === 'VND' && settings.defaultCurrency === 'USD') return amount / usdToVnd;
    return amount;
  }

  const summary = useMemo(() => {
    const income = accountTransactions
      .filter((x) => x.type === 'income')
      .reduce((sum, x) => sum + toMainCurrency(x.amount, x.currency), 0);
    const expense = accountTransactions
      .filter((x) => x.type === 'expense')
      .reduce((sum, x) => sum + toMainCurrency(x.amount, x.currency), 0);
    return { income, expense, balance: income - expense };
  }, [accountTransactions, settings.defaultCurrency, usdToVnd]);

  const filteredExpenseItems = useMemo(() => {
    const now = new Date();
    let from = new Date(0);
    let to = new Date(now);

    if (periodFilter === 'day') {
      from = startOfDay(now);
      to = new Date(from);
      to.setDate(to.getDate() + 1);
    } else if (periodFilter === 'week') {
      from = startOfWeek(now);
      to = new Date(from);
      to.setDate(to.getDate() + 7);
    } else if (periodFilter === 'month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    } else if (periodFilter === 'year') {
      from = new Date(now.getFullYear(), 0, 1);
      to = new Date(now.getFullYear() + 1, 0, 1);
    } else {
      const parsedFrom = customFrom ? new Date(customFrom) : new Date(0);
      const parsedTo = customTo ? new Date(customTo) : new Date(now);
      from = Number.isNaN(parsedFrom.getTime()) ? new Date(0) : startOfDay(parsedFrom);
      to = Number.isNaN(parsedTo.getTime()) ? new Date(now) : new Date(parsedTo);
      to.setDate(to.getDate() + 1);
    }

    return accountTransactions.filter((tx) => {
      if (tx.type !== 'expense') return false;
      const d = new Date(tx.date);
      return d >= from && d < to;
    });
  }, [accountTransactions, periodFilter, customFrom, customTo]);

  const expenseByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of filteredExpenseItems) {
      const key = tx.category || 'Other';
      map.set(key, (map.get(key) ?? 0) + toMainCurrency(tx.amount, tx.currency));
    }
    const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
    const items = Array.from(map.entries())
      .map(([category, amount]) => ({ category, amount, pct: total > 0 ? (amount / total) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount);
    return { total, items };
  }, [filteredExpenseItems, settings.defaultCurrency, usdToVnd]);

  async function signInOrSignUp() {
    Keyboard.dismiss();
    if (!username.trim() || !password.trim()) return;

    try {
      if (authMode === 'login') {
        const loggedIn = await loginLocal(username.trim(), password);
        setUser(loggedIn);
        return;
      }

      const registered = await registerLocal(username.trim(), password);
      setUser(registered);
      Alert.alert('Registered', 'Your account has been created.');
    } catch (e) {
      Alert.alert(authMode === 'login' ? 'Login failed' : 'Register failed', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  async function signOut() {
    await signOutLocal();
    setUser(null);
    setUsername('');
    setPassword('');
  }

  function buildTx(parsed: Omit<Transaction, 'id' | 'accountId' | 'createdAt'>, mode: Transaction['inputMode'], receipt?: ReceiptFile | null) {
    if (!selectedAccountId) {
      Alert.alert(t(language, 'accountRequired'));
      return null;
    }

    return {
      ...parsed,
      id: createId('tx'),
      accountId: selectedAccountId,
      createdAt: new Date().toISOString(),
      inputMode: mode,
      receiptUri: receipt?.uri,
      receiptType: receipt?.type,
      receiptName: receipt?.name,
    } as Transaction;
  }

  function pushTx(tx: Transaction | null) {
    if (!tx) return;
    setTransactions((prev) => [tx, ...prev]);
    setPendingReceipt(null);
    Alert.alert(t(language, 'saved'));
  }

  function applyEntryDate<T extends { date: string }>(parsed: T): T {
    return { ...parsed, date: entryDate };
  }

  async function onManualSave() {
    Keyboard.dismiss();
    const raw = manualRaw.trim();
    if (!raw) return;

    try {
      const parsed = applyEntryDate(parseTransactionInput(raw, 'manual', language, settings.defaultCurrency, manualType));
      pushTx(buildTx(parsed, 'manual', pendingReceipt));
      setManualRaw('');
    } catch {
      Alert.alert(t(language, 'invalidInput'));
    }
  }

  async function onAiTextSave() {
    Keyboard.dismiss();
    if (!hasLLMConfig()) {
      Alert.alert('AI key missing', t(language, 'aiKeyMissing'));
      return;
    }
    if (!aiRaw.trim()) return;

    try {
      let parsed;
      try {
        // Local-first to reduce API calls/latency when shorthand input is parseable.
        parsed = parseTransactionInput(aiRaw.trim(), 'text', language, settings.defaultCurrency, aiType);
      } catch {
        setLoading(true);
        parsed = await normalizeTextToTransaction(aiRaw.trim(), language, settings.defaultCurrency, aiType);
      }
      parsed = applyEntryDate(parsed);
      pushTx(buildTx(parsed, 'text', pendingReceipt));
      setAiRaw('');
    } catch (e) {
      Alert.alert('AI parse error', e instanceof Error ? e.message : t(language, 'invalidInput'));
    } finally {
      setLoading(false);
    }
  }

  async function onStartVoiceRecording() {
    Keyboard.dismiss();
    if (!hasLLMConfig()) {
      Alert.alert('AI key missing', t(language, 'aiKeyMissing'));
      return;
    }

    try {
      if (recording) return;
      setRecording(await startRecording());
    } catch (e) {
      setRecording(null);
      Alert.alert('Voice error', e instanceof Error ? e.message : 'Failed');
    }
  }

  async function onStopVoiceRecording() {
    if (!recording) return;
    try {
      setLoading(true);
      const uri = await stopRecording(recording);
      setRecording(null);
      const transcript = await transcribeAudio(uri, language);
      let parsed;
      try {
        parsed = parseTransactionInput(transcript, 'voice', language, settings.defaultCurrency, aiType);
      } catch {
        parsed = await normalizeTextToTransaction(transcript, language, settings.defaultCurrency, aiType);
      }
      parsed = applyEntryDate(parsed);
      pushTx(buildTx(parsed, 'voice', pendingReceipt));
    } catch (e) {
      setRecording(null);
      Alert.alert('Voice error', e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  async function onImageAi(source: 'camera' | 'upload') {
    if (!hasLLMConfig()) {
      Alert.alert('AI key missing', t(language, 'aiKeyMissing'));
      return;
    }

    try {
      setLoading(true);
      const receipt = source === 'camera' ? await takeReceiptPhoto() : await uploadReceiptImage();
      if (!receipt) return;
      const extracted = await extractReceiptText(receipt.uri, language);
      let parsed;
      try {
        parsed = parseTransactionInput(extracted, 'image', language, settings.defaultCurrency, 'expense');
      } catch {
        parsed = await normalizeTextToTransaction(extracted, language, settings.defaultCurrency, 'expense');
      }
      parsed = applyEntryDate(parsed);
      pushTx(buildTx(parsed, 'image', receipt));
    } catch (e) {
      Alert.alert('Image error', e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  async function onAttachFile() {
    try {
      const file = await pickReceiptFile();
      if (file) setPendingReceipt(file);
    } catch (e) {
      Alert.alert('Attachment error', e instanceof Error ? e.message : 'Failed');
    }
  }

  function onOpenReceipt(uri: string) {
    Linking.openURL(uri).catch(() => Alert.alert('Could not open file'));
  }

  function onOpenReceiptImage(uri: string) {
    setReceiptViewerUri(uri);
  }

  function openNativeDatePicker(target: 'from' | 'to' | 'entry') {
    const seed =
      target === 'from'
        ? customFrom
          ? new Date(customFrom)
          : new Date()
        : target === 'to'
          ? customTo
            ? new Date(customTo)
            : new Date()
          : entryDate
            ? new Date(entryDate)
            : new Date();
    const safeSeed = Number.isNaN(seed.getTime()) ? new Date() : seed;
    setDatePickerValue(safeSeed);
    setDatePickerDraft(safeSeed);
    setDatePickerTarget(target);
    setShowDatePicker(true);
  }

  function onDatePicked(event: DateTimePickerEvent, selected?: Date) {
    if (event.type === 'dismissed') {
      if (Platform.OS !== 'ios') setShowDatePicker(false);
      return;
    }
    if (!selected) return;

    if (Platform.OS === 'ios') {
      setDatePickerDraft(selected);
      return;
    }

    const iso = selected.toISOString().slice(0, 10);
    if (datePickerTarget === 'from') setCustomFrom(iso);
    else if (datePickerTarget === 'to') setCustomTo(iso);
    else setEntryDate(iso);
    setDatePickerValue(selected);
    setShowDatePicker(false);
  }

  function closeDatePicker() {
    setShowDatePicker(false);
  }

  function applyDatePicker() {
    const iso = datePickerDraft.toISOString().slice(0, 10);
    if (datePickerTarget === 'from') setCustomFrom(iso);
    else if (datePickerTarget === 'to') setCustomTo(iso);
    else setEntryDate(iso);
    setDatePickerValue(datePickerDraft);
    setShowDatePicker(false);
  }

  async function onSaveUsername() {
    Keyboard.dismiss();
    if (!user) return;
    try {
      const nextUser = await updateLocalUsername(user.id, profileUsername);
      setUser(nextUser);
      Alert.alert('Thành công', 'Đã đổi tên tài khoản.');
    } catch (e) {
      Alert.alert('Lỗi', e instanceof Error ? e.message : 'Không thể đổi tên');
    }
  }

  async function onChangePassword() {
    Keyboard.dismiss();
    if (!user) return;
    if (!oldPassword || !nextPassword) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập mật khẩu cũ và mật khẩu mới.');
      return;
    }
    try {
      await updateLocalPassword(user.id, oldPassword, nextPassword);
      setOldPassword('');
      setNextPassword('');
      Alert.alert('Thành công', 'Đã đổi mật khẩu.');
    } catch (e) {
      Alert.alert('Lỗi', e instanceof Error ? e.message : 'Không thể đổi mật khẩu');
    }
  }

  function onDeleteUserAccount() {
    Keyboard.dismiss();
    if (!user) return;
    if (!deletePassword) {
      Alert.alert('Thiếu mật khẩu', 'Nhập mật khẩu để xóa tài khoản.');
      return;
    }
    Alert.alert('Xóa tài khoản', 'Bạn chắc chắn muốn xóa tài khoản và toàn bộ dữ liệu?', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: async () => {
          try {
            await clearUserData(user.id);
            await deleteLocalAccount(user.id, deletePassword);
            setDeletePassword('');
            setUser(null);
          } catch (e) {
            Alert.alert('Lỗi', e instanceof Error ? e.message : 'Không thể xóa tài khoản');
          }
        },
      },
    ]);
  }

  function onAddAccount() {
    Keyboard.dismiss();
    const name = newAccountName.trim();
    if (!name) return;

    const account: Account = {
      id: createId('acc'),
      name,
      currency: settings.defaultCurrency,
      createdAt: new Date().toISOString(),
    };

    setAccounts((prev) => [account, ...prev]);
    setSettings((prev) => ({ ...prev, defaultAccountId: prev.defaultAccountId ?? account.id }));
    setNewAccountName('');
  }

  function onDeleteAccount(id: string) {
    if (accounts.length <= 1) {
      Alert.alert('Không thể xóa', 'Bạn cần giữ ít nhất 1 tài khoản.');
      return;
    }

    const next = accounts.filter((a) => a.id !== id);
    setAccounts(next);

    if (settings.defaultAccountId === id) {
      setSettings((prev) => ({ ...prev, defaultAccountId: next[0]?.id }));
    }
  }

  function onDeleteTx(id: string) {
    setTransactions((prev) => prev.filter((x) => x.id !== id));
    setSelectedTx(null);
  }

  function toggleAccountPanel(next: 'profile' | 'theme' | 'language') {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setAccountPanel((prev) => (prev === next ? null : next));
  }

  function renderAuth() {
    return (
      <View style={styles.centerWrap}>
        <Text style={styles.authTitle}>MoneyTrack</Text>
        <Text style={styles.subtle}>
          {authMode === 'login'
            ? language === 'vi'
              ? 'Đăng nhập để tiếp tục'
              : 'Login to continue'
            : language === 'vi'
              ? 'Tạo tài khoản mới'
              : 'Create a new account'}
        </Text>

        <View style={styles.blockCard}>
          <Text style={styles.subtle}>{t(language, 'language')}</Text>
          <View style={styles.rowGap}>
            <Chip label="Tiếng Việt" active={language === 'vi'} onPress={() => setGuestLanguage('vi')} palette={palette} />
            <Chip label="English" active={language === 'en'} onPress={() => setGuestLanguage('en')} palette={palette} />
          </View>

          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => Keyboard.dismiss()}
            placeholder={language === 'vi' ? 'Tên đăng nhập' : 'Username'}
            placeholderTextColor={palette.sub}
          />
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={signInOrSignUp}
            placeholder={language === 'vi' ? 'Mật khẩu' : 'Password'}
            placeholderTextColor={palette.sub}
          />
          <Pressable style={styles.primaryBtn} onPress={signInOrSignUp}>
            <Text style={styles.primaryBtnText}>{authMode === 'login' ? (language === 'vi' ? 'Đăng nhập' : 'Login') : language === 'vi' ? 'Đăng ký' : 'Register'}</Text>
          </Pressable>
          <Pressable style={styles.authLinkWrap} onPress={() => setAuthMode((m) => (m === 'login' ? 'register' : 'login'))}>
            <Text style={styles.authLinkText}>
              {authMode === 'login'
                ? language === 'vi'
                  ? 'Chưa có tài khoản? Đăng ký tài khoản mới'
                  : "Don't have an account? Create one"
                : language === 'vi'
                  ? 'Đã có tài khoản? Đăng nhập'
                  : 'Already have an account? Login'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderOnboarding() {
    return (
      <View style={styles.centerWrap}>
        <Text style={styles.authTitle}>{t(language, 'onboardingTitle')}</Text>
        <Text style={styles.subtle}>{t(language, 'onboardingSubtitle')}</Text>

        <View style={styles.blockCard}>
          <Text style={styles.subtle}>{t(language, 'language')}</Text>
          <View style={styles.rowGap}>
            <Chip label="English" active={settings.language === 'en'} onPress={() => setSettings((s) => ({ ...s, language: 'en' }))} palette={palette} />
            <Chip label="Tiếng Việt" active={settings.language === 'vi'} onPress={() => setSettings((s) => ({ ...s, language: 'vi' }))} palette={palette} />
          </View>

          <Text style={styles.subtle}>{t(language, 'defaultCurrency')}</Text>
          <View style={styles.rowGap}>
            <Chip label="VND" active={settings.defaultCurrency === 'VND'} onPress={() => setSettings((s) => ({ ...s, defaultCurrency: 'VND' }))} palette={palette} />
            <Chip label="USD" active={settings.defaultCurrency === 'USD'} onPress={() => setSettings((s) => ({ ...s, defaultCurrency: 'USD' }))} palette={palette} />
          </View>

          <Text style={styles.subtle}>{t(language, 'theme')}</Text>
          <View style={styles.rowGap}>
            <Chip label={t(language, 'dark')} active={settings.theme === 'dark'} onPress={() => setSettings((s) => ({ ...s, theme: 'dark' }))} palette={palette} />
            <Chip label={t(language, 'light')} active={settings.theme === 'light'} onPress={() => setSettings((s) => ({ ...s, theme: 'light' }))} palette={palette} />
          </View>

          <Pressable style={styles.primaryBtn} onPress={() => setSettings((s) => ({ ...s, onboardingCompleted: true }))}>
            <Text style={styles.primaryBtnText}>{t(language, 'continue')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderHome() {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={styles.page} contentContainerStyle={styles.pagePad}>
        <View style={styles.balanceCard}>
          <Text style={styles.subtle}>{t(language, 'totalBalance')}</Text>
          <Text style={styles.balanceText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.58}>
            {formatAmount(summary.balance, settings.defaultCurrency, locale)}
          </Text>
          <View style={styles.rowGap}>
            <View style={styles.statCard}><Text style={styles.subtle}>{t(language, 'expense')}</Text><Text style={styles.danger}>{formatAmount(summary.expense, settings.defaultCurrency, locale)}</Text></View>
            <View style={styles.statCard}><Text style={styles.subtle}>{t(language, 'income')}</Text><Text style={styles.success}>{formatAmount(summary.income, settings.defaultCurrency, locale)}</Text></View>
          </View>
        </View>

        <View style={styles.homeMiniRow}>
          <View style={styles.accountListCard}>
            <Text style={styles.smallBlockTitle}>{t(language, 'accountList')}</Text>
            <View style={styles.accountChipWrap}>
              {accounts.map((a) => (
                <Pressable key={a.id} style={[styles.accountChip, selectedAccountId === a.id && styles.accountChipActive]} onPress={() => setSettings((prev) => ({ ...prev, defaultAccountId: a.id }))}>
                  <Text numberOfLines={1} style={[styles.accountChipText, selectedAccountId === a.id && styles.accountChipTextActive]}>{a.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.fxCard}>
            <Text style={styles.smallBlockTitle}>{t(language, 'fxTitle')}</Text>
            <Text style={styles.fxStrong}>1 USD = {usdToVnd.toLocaleString(locale)} VND</Text>
            <Text numberOfLines={1} style={styles.fxTiny}>{t(language, 'fxUpdated')}: {new Date(fxRate?.fetchedAt ?? Date.now()).toLocaleTimeString(locale)}</Text>
          </View>
        </View>

        <Text style={styles.headerText}>{t(language, 'recentTransactions')}</Text>
        {accountTransactions.slice(0, 12).map((tx) => {
          const converted = toMainCurrency(tx.amount, tx.currency);
          return (
            <Pressable key={tx.id} style={styles.txCard} onPress={() => setSelectedTx(tx)}>
              <View style={styles.txLeft}>
                <Text style={styles.txName} numberOfLines={2} ellipsizeMode="tail">{tx.note || tx.category}</Text>
                <Text style={styles.subtle}>{tx.date} • {tx.category} • {tx.currency}</Text>
              </View>
              <View style={styles.txRight}>
                <Text style={[tx.type === 'income' ? styles.success : styles.danger, styles.amountText]} numberOfLines={1}>
                  {tx.type === 'income' ? '+' : '-'}{formatAmount(converted, settings.defaultCurrency, locale)}
                </Text>
                <Text style={styles.subtle}>{tx.receiptUri ? tx.receiptType?.toUpperCase() : '-'}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    );
  }

  function renderTransactions() {
    const groups = groupedByDate(accountTransactions);

    return (
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={styles.page} contentContainerStyle={styles.pagePad}>
        <View style={styles.blockCard}>
          <Text style={styles.blockTitle}>{t(language, 'chartTitle')}</Text>
          <View style={styles.rowGapWrap}>
            <MiniChip label={t(language, 'periodDay')} active={periodFilter === 'day'} onPress={() => setPeriodFilter('day')} styles={styles} />
            <MiniChip label={t(language, 'periodWeek')} active={periodFilter === 'week'} onPress={() => setPeriodFilter('week')} styles={styles} />
            <MiniChip label={t(language, 'periodMonth')} active={periodFilter === 'month'} onPress={() => setPeriodFilter('month')} styles={styles} />
            <MiniChip label={t(language, 'periodYear')} active={periodFilter === 'year'} onPress={() => setPeriodFilter('year')} styles={styles} />
            <MiniChip label={t(language, 'periodCustom')} active={periodFilter === 'custom'} onPress={() => setPeriodFilter('custom')} styles={styles} />
          </View>

          {periodFilter === 'custom' ? (
            <View style={styles.rowGap}>
              <Pressable style={[styles.input, styles.dateBtn]} onPress={() => openNativeDatePicker('from')}>
                <Text style={customFrom ? styles.dateText : styles.datePlaceholder}>{customFrom || t(language, 'fromDate')}</Text>
              </Pressable>
              <Pressable style={[styles.input, styles.dateBtn]} onPress={() => openNativeDatePicker('to')}>
                <Text style={customTo ? styles.dateText : styles.datePlaceholder}>{customTo || t(language, 'toDate')}</Text>
              </Pressable>
            </View>
          ) : null}

          <Text style={styles.subtle}>{t(language, 'byCategory')} • {formatAmount(expenseByCategory.total, settings.defaultCurrency, locale)}</Text>
          <View style={styles.donutWrap}>
            <DonutChart
              size={164}
              strokeWidth={20}
              segments={expenseByCategory.items.slice(0, 6).map((item, idx) => ({
                value: item.amount,
                color: DONUT_COLORS[idx % DONUT_COLORS.length],
              }))}
              trackColor={palette.muted}
            />
            <View style={styles.donutCenter}>
              <Text style={styles.donutValue}>{formatAmount(expenseByCategory.total, settings.defaultCurrency, locale)}</Text>
              <Text style={styles.donutLabel}>{t(language, 'expense')}</Text>
            </View>
          </View>
          {expenseByCategory.items.length === 0 ? <Text style={styles.subtle}>{t(language, 'emptyTransactions')}</Text> : null}
          {expenseByCategory.items.slice(0, 8).map((item) => (
            <View key={item.category} style={styles.catRow}>
              <View style={styles.catTop}>
                <Text style={styles.catName} numberOfLines={1} ellipsizeMode="tail">{item.category}</Text>
                <Text style={styles.catAmount}>{formatAmount(item.amount, settings.defaultCurrency, locale)} ({item.pct.toFixed(0)}%)</Text>
              </View>
              <View style={styles.catTrack}>
                <View style={[styles.catFill, { width: `${Math.max(4, item.pct)}%` }]} />
              </View>
            </View>
          ))}
        </View>

        {groups.length === 0 ? <Text style={styles.subtle}>{t(language, 'emptyTransactions')}</Text> : null}
        {groups.map(([date, items]) => {
          const net = items.reduce((sum, tx) => sum + (tx.type === 'income' ? toMainCurrency(tx.amount, tx.currency) : -toMainCurrency(tx.amount, tx.currency)), 0);
          return (
            <View key={date} style={styles.blockCard}>
              <View style={styles.lineRow}>
                <Text style={styles.blockTitle}>{new Date(date).toLocaleDateString(locale)}</Text>
                <Text style={net >= 0 ? styles.success : styles.danger}>{net >= 0 ? '+' : '-'}{formatAmount(Math.abs(net), settings.defaultCurrency, locale)}</Text>
              </View>
              {items.map((tx) => {
                const converted = toMainCurrency(tx.amount, tx.currency);
                return (
                  <Pressable key={tx.id} style={styles.lineRow} onPress={() => setSelectedTx(tx)}>
                    <Text style={styles.lineTextShrink} numberOfLines={1} ellipsizeMode="tail">{tx.note || tx.category}</Text>
                    <Text style={tx.type === 'income' ? styles.success : styles.danger}>{tx.type === 'income' ? '+' : '-'}{formatAmount(converted, settings.defaultCurrency, locale)}</Text>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </ScrollView>
    );
  }

  function renderAdd() {
    const currentType = addMode === 'manual' ? manualType : aiType;
    const setCurrentType = (next: TransactionType) => {
      if (addMode === 'manual') setManualType(next);
      else setAiType(next);
    };

    return (
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={styles.page} contentContainerStyle={styles.pagePad}>
        <View style={styles.blockCard}>
          <Text style={styles.blockTitle}>{language === 'vi' ? 'Thêm giao dịch' : 'Add transaction'}</Text>

          <Text style={styles.formLabel}>{language === 'vi' ? '1) Chế độ nhập' : '1) Input mode'}</Text>
          <View style={styles.segmentWrap}>
            <Pressable style={[styles.segmentBtn, addMode === 'manual' && styles.segmentBtnActive]} onPress={() => setAddMode('manual')}>
              <Text style={[styles.segmentText, addMode === 'manual' && styles.segmentTextActive]}>{language === 'vi' ? 'Thủ công (nhanh)' : 'Manual (fast)'}</Text>
            </Pressable>
            <Pressable style={[styles.segmentBtn, addMode === 'ai' && styles.segmentBtnActive]} onPress={() => setAddMode('ai')}>
              <Text style={[styles.segmentText, addMode === 'ai' && styles.segmentTextActive]}>AI</Text>
            </Pressable>
          </View>

          <Text style={styles.formLabel}>{language === 'vi' ? '2) Loại giao dịch' : '2) Transaction type'}</Text>
          <View style={styles.segmentWrap}>
            <Pressable style={[styles.segmentBtn, currentType === 'expense' && styles.segmentBtnActive]} onPress={() => setCurrentType('expense')}>
              <Text style={[styles.segmentText, currentType === 'expense' && styles.segmentTextActive]}>{t(language, 'expense')}</Text>
            </Pressable>
            <Pressable style={[styles.segmentBtn, currentType === 'income' && styles.segmentBtnActive]} onPress={() => setCurrentType('income')}>
              <Text style={[styles.segmentText, currentType === 'income' && styles.segmentTextActive]}>{t(language, 'income')}</Text>
            </Pressable>
          </View>

          <Text style={styles.formLabel}>{language === 'vi' ? '3) Ngày giao dịch' : '3) Transaction date'}</Text>
          <Pressable style={[styles.input, styles.dateBtn]} onPress={() => openNativeDatePicker('entry')}>
            <Text style={styles.dateText}>{new Date(entryDate).toLocaleDateString(locale)}</Text>
          </Pressable>

          {addMode === 'manual' ? (
            <>
              <Text style={styles.formLabel}>{language === 'vi' ? '4) Nội dung nhập' : '4) Input content'}</Text>
              <Text style={styles.formHint}>{language === 'vi' ? 'Ví dụ: cafe 45k, ăn trưa 60k, lương 20tr' : 'Example: coffee 3 usd, lunch 8 usd, salary 1200 usd'}</Text>
              <TextInput
                style={styles.composerInput}
                value={manualRaw}
                onChangeText={setManualRaw}
                placeholder={t(language, 'manualPlaceholder')}
                placeholderTextColor={palette.sub}
                returnKeyType="done"
                onSubmitEditing={onManualSave}
              />
              <Pressable style={styles.attachRow} onPress={onAttachFile}>
                <Ionicons name="attach-outline" size={16} color={palette.accent} />
                <Text style={styles.attachText}>{t(language, 'receiptFile')}</Text>
              </Pressable>
              {pendingReceipt ? <Text style={styles.subtle}>{t(language, 'receiptAttached')}: {pendingReceipt.name ?? pendingReceipt.type}</Text> : null}
              <Pressable style={styles.primaryBtn} onPress={onManualSave}><Text style={styles.primaryBtnText}>{t(language, 'parseLocal')}</Text></Pressable>
            </>
          ) : (
            <>
              <Text style={styles.formLabel}>{language === 'vi' ? '4) Mô tả cho AI' : '4) Prompt for AI'}</Text>
              <Text style={styles.formHint}>{language === 'vi' ? 'Nhập text hoặc dùng ghi âm/chụp hóa đơn bên dưới.' : 'Type text or use voice/receipt buttons below.'}</Text>
              <TextInput style={styles.composerInput} value={aiRaw} onChangeText={setAiRaw} placeholder={t(language, 'aiTextPlaceholder')} placeholderTextColor={palette.sub} returnKeyType="done" onSubmitEditing={onAiTextSave} />
              <Pressable style={styles.primaryBtn} onPress={onAiTextSave}><Text style={styles.primaryBtnText}>{loading ? t(language, 'processing') : t(language, 'parseAndSave')}</Text></Pressable>
              <View style={styles.rowGapWrap}>
                <Pressable style={styles.quickActionBtn} onPress={onStartVoiceRecording} disabled={Boolean(recording)}>
                  <Text style={styles.ghostText}>{recording ? 'Đang ghi âm...' : t(language, 'startVoice')}</Text>
                </Pressable>
                <Pressable style={styles.quickActionBtn} onPress={() => onImageAi('camera')}><Text style={styles.ghostText}>{t(language, 'receiptCamera')}</Text></Pressable>
                <Pressable style={styles.quickActionBtn} onPress={() => onImageAi('upload')}><Text style={styles.ghostText}>{t(language, 'receiptUpload')}</Text></Pressable>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    );
  }

  function renderWallets() {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={styles.page} contentContainerStyle={styles.pagePad}>
        <View style={styles.blockCard}>
          <Text style={styles.blockTitle}>Tiền tệ chính</Text>

          <View style={styles.rowGap}>
            <Chip label="VND" active={settings.defaultCurrency === 'VND'} onPress={() => setSettings((s) => ({ ...s, defaultCurrency: 'VND' }))} palette={palette} />
            <Chip label="USD" active={settings.defaultCurrency === 'USD'} onPress={() => setSettings((s) => ({ ...s, defaultCurrency: 'USD' }))} palette={palette} />
          </View>
        </View>

        <View style={styles.blockCard}>
          <Text style={styles.blockTitle}>Thêm tài khoản thu chi</Text>
          <TextInput style={styles.input} value={newAccountName} onChangeText={setNewAccountName} placeholder={t(language, 'accountName')} placeholderTextColor={palette.sub} returnKeyType="done" onSubmitEditing={onAddAccount} />
          <Pressable style={styles.primaryBtn} onPress={onAddAccount}><Text style={styles.primaryBtnText}>{t(language, 'addAccount')}</Text></Pressable>
        </View>

        <View style={styles.blockCard}>
          <Text style={styles.blockTitle}>Quản lý tài khoản</Text>
          {accounts.map((acc) => {
            const isDefault = settings.defaultAccountId === acc.id;
            return (
              <View key={acc.id} style={styles.accountRow}>
                <Pressable style={styles.accountMain} onPress={() => setSettings((prev) => ({ ...prev, defaultAccountId: acc.id }))}>
                  <Text style={styles.lineText}>{acc.name}</Text>
                  <Text style={styles.subtle}>{isDefault ? 'Mặc định' : 'Chạm để chọn làm mặc định'} • {acc.currency}</Text>
                </Pressable>
                <Pressable style={styles.iconBtn} onPress={() => onDeleteAccount(acc.id)}>
                  <Ionicons name="trash-outline" size={16} color={palette.danger} />
                </Pressable>
              </View>
            );
          })}
        </View>
      </ScrollView>
    );
  }

  function renderAccount() {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={styles.page} contentContainerStyle={styles.pagePad}>
        <View style={styles.blockCard}>
          <Text style={styles.blockTitle}>Tài khoản</Text>
          <Pressable style={styles.settingRow} onPress={() => toggleAccountPanel('profile')}>
            <View style={styles.settingLeft}>
              <View style={styles.settingIconWrap}><Ionicons name="person-outline" size={16} color={palette.sub} /></View>
              <Text style={styles.lineText}>1. Tài khoản</Text>
            </View>
            <Ionicons name={accountPanel === 'profile' ? 'chevron-up' : 'chevron-down'} size={18} color={palette.sub} />
          </Pressable>
          {accountPanel === 'profile' ? (
            <View style={styles.panelBody}>
              <Text style={styles.subtle}>Tên đăng nhập</Text>
              <TextInput style={styles.input} value={profileUsername} onChangeText={setProfileUsername} placeholder="Tên đăng nhập mới" placeholderTextColor={palette.sub} returnKeyType="done" onSubmitEditing={onSaveUsername} />
              <Pressable style={styles.ghostBtn} onPress={onSaveUsername}><Text style={styles.ghostText}>Đổi tên tài khoản</Text></Pressable>

              <Text style={styles.subtle}>Đổi mật khẩu</Text>
              <TextInput style={styles.input} value={oldPassword} onChangeText={setOldPassword} secureTextEntry placeholder="Mật khẩu cũ" placeholderTextColor={palette.sub} returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => Keyboard.dismiss()} />
              <TextInput style={styles.input} value={nextPassword} onChangeText={setNextPassword} secureTextEntry placeholder="Mật khẩu mới" placeholderTextColor={palette.sub} returnKeyType="done" onSubmitEditing={onChangePassword} />
              <Pressable style={styles.ghostBtn} onPress={onChangePassword}><Text style={styles.ghostText}>Cập nhật mật khẩu</Text></Pressable>

              <Text style={styles.subtle}>Xóa tài khoản</Text>
              <TextInput style={styles.input} value={deletePassword} onChangeText={setDeletePassword} secureTextEntry placeholder="Nhập mật khẩu để xác nhận" placeholderTextColor={palette.sub} returnKeyType="done" onSubmitEditing={onDeleteUserAccount} />
              <Pressable style={styles.logoutBtn} onPress={onDeleteUserAccount}><Text style={styles.logoutText}>Xóa tài khoản</Text></Pressable>
            </View>
          ) : null}

          <Pressable style={styles.settingRow} onPress={() => toggleAccountPanel('theme')}>
            <View style={styles.settingLeft}>
              <View style={styles.settingIconWrap}><Ionicons name="contrast-outline" size={16} color={palette.sub} /></View>
              <Text style={styles.lineText}>2. Chế độ sáng/tối</Text>
            </View>
            <Ionicons name={accountPanel === 'theme' ? 'chevron-up' : 'chevron-down'} size={18} color={palette.sub} />
          </Pressable>
          {accountPanel === 'theme' ? (
            <View style={styles.panelBody}>
              <View style={styles.rowGap}>
                <Chip label={t(language, 'dark')} active={settings.theme === 'dark'} onPress={() => setSettings((s) => ({ ...s, theme: 'dark' as ThemeMode }))} palette={palette} />
                <Chip label={t(language, 'light')} active={settings.theme === 'light'} onPress={() => setSettings((s) => ({ ...s, theme: 'light' as ThemeMode }))} palette={palette} />
              </View>
            </View>
          ) : null}

          <Pressable style={styles.settingRow} onPress={() => toggleAccountPanel('language')}>
            <View style={styles.settingLeft}>
              <View style={styles.settingIconWrap}><Ionicons name="language-outline" size={16} color={palette.sub} /></View>
              <Text style={styles.lineText}>3. Ngôn ngữ</Text>
            </View>
            <Ionicons name={accountPanel === 'language' ? 'chevron-up' : 'chevron-down'} size={18} color={palette.sub} />
          </Pressable>
          {accountPanel === 'language' ? (
            <View style={styles.panelBody}>
              <View style={styles.rowGap}>
                <Chip label="Tiếng Việt" active={settings.language === 'vi'} onPress={() => setSettings((s) => ({ ...s, language: 'vi' }))} palette={palette} />
                <Chip label="English" active={settings.language === 'en'} onPress={() => setSettings((s) => ({ ...s, language: 'en' }))} palette={palette} />
              </View>
            </View>
          ) : null}

          <Pressable style={styles.settingRow} onPress={signOut}>
            <View style={styles.settingLeft}>
              <View style={styles.settingIconWrap}><Ionicons name="log-out-outline" size={16} color={palette.danger} /></View>
              <Text style={[styles.lineText, styles.logoutText]}>4. Đăng xuất</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.sub} />
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

        {!user ? (
          renderAuth()
        ) : !settings.onboardingCompleted ? (
          renderOnboarding()
        ) : (
          <>
            <View style={styles.topBar}>
              <Text style={styles.appTitle}>{t(language, 'appTitle')}</Text>
              <Text style={styles.subtle}>{accounts.find((x) => x.id === selectedAccountId)?.name ?? 'Wallet'}</Text>
            </View>

            <Animated.View
              style={[
                styles.main,
                {
                  opacity: tabAnim,
                  transform: [
                    {
                      translateY: tabAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [12, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              {tab === 'home'
                ? renderHome()
                : tab === 'transactions'
                  ? renderTransactions()
                  : tab === 'add'
                    ? renderAdd()
                    : tab === 'wallets'
                      ? renderWallets()
                      : renderAccount()}
            </Animated.View>

            <View style={styles.bottomNav}>
              <TabButton icon="home-outline" label={t(language, 'home')} active={tab === 'home'} onPress={() => setTab('home')} styles={styles} palette={palette} />
              <TabButton icon="swap-horizontal-outline" label={t(language, 'transactions')} active={tab === 'transactions'} onPress={() => setTab('transactions')} styles={styles} palette={palette} />
              <Pressable style={styles.fab} onPress={() => setTab('add')}><Ionicons name="add" size={28} color={theme === 'dark' ? '#00140b' : '#ffffff'} /></Pressable>
              <TabButton icon="wallet-outline" label={language === 'vi' ? 'Ví' : 'Wallets'} active={tab === 'wallets'} onPress={() => setTab('wallets')} styles={styles} palette={palette} />
              <TabButton icon="person-outline" label={t(language, 'accounts')} active={tab === 'accounts'} onPress={() => setTab('accounts')} styles={styles} palette={palette} />
            </View>

            <Modal visible={Boolean(selectedTx)} transparent animationType="slide" onRequestClose={() => setSelectedTx(null)}>
              <View style={styles.modalBackdrop}>
                <View style={styles.modalCard}>
                  {selectedTx ? (
                    <>
                      <Text style={styles.blockTitle}>{t(language, 'transactionDetail')}</Text>
                      <Text style={styles.lineText}>{selectedTx.note || selectedTx.category}</Text>
                      <Text style={styles.subtle}>{selectedTx.date} • {selectedTx.category}</Text>

                      {selectedTx.receiptUri ? (
                        <View style={styles.receiptWrap}>
                          {selectedTx.receiptType === 'image' ? (
                            <Pressable onPress={() => onOpenReceiptImage(selectedTx.receiptUri!)}>
                              <Image source={{ uri: selectedTx.receiptUri }} style={styles.receiptImage} resizeMode="contain" />
                            </Pressable>
                          ) : null}
                          {selectedTx.receiptType === 'pdf' ? <Text style={styles.subtle}>PDF: {selectedTx.receiptName ?? 'receipt.pdf'}</Text> : null}
                          {selectedTx.receiptType === 'text' ? <Text style={styles.subtle}>{txtContent || 'Loading...'}</Text> : null}
                          {selectedTx.receiptType === 'image' ? (
                            <Pressable style={styles.ghostBtn} onPress={() => onOpenReceiptImage(selectedTx.receiptUri!)}>
                              <Text style={styles.ghostText}>{t(language, 'openReceipt')}</Text>
                            </Pressable>
                          ) : (
                            <Pressable style={styles.ghostBtn} onPress={() => onOpenReceipt(selectedTx.receiptUri!)}>
                              <Text style={styles.ghostText}>{t(language, 'openReceipt')}</Text>
                            </Pressable>
                          )}
                        </View>
                      ) : (
                        <Text style={styles.subtle}>{t(language, 'noReceipt')}</Text>
                      )}

                      <View style={styles.rowGap}>
                        <Pressable style={styles.ghostBtn} onPress={() => onDeleteTx(selectedTx.id)}><Text style={styles.danger}>{t(language, 'delete')}</Text></Pressable>
                        <Pressable style={styles.ghostBtn} onPress={() => setSelectedTx(null)}><Text style={styles.success}>{t(language, 'close')}</Text></Pressable>
                      </View>
                    </>
                  ) : null}
                </View>
              </View>
            </Modal>

            <Modal visible={Boolean(receiptViewerUri)} transparent animationType="fade" onRequestClose={() => setReceiptViewerUri(null)}>
              <View style={styles.receiptViewerBackdrop}>
                <Pressable style={styles.receiptViewerClose} onPress={() => setReceiptViewerUri(null)}>
                  <Text style={styles.ghostText}>{t(language, 'close')}</Text>
                </Pressable>
                {receiptViewerUri ? <Image source={{ uri: receiptViewerUri }} style={styles.receiptViewerImage} resizeMode="contain" /> : null}
              </View>
            </Modal>

            <Modal visible={loading} transparent animationType="fade">
              <View style={styles.loadingBackdrop}>
                <View style={styles.loadingCard}>
                  <ActivityIndicator size="large" color={palette.accent} />
                  <Text style={styles.loadingText}>{t(language, 'processing')}</Text>
                </View>
              </View>
            </Modal>

            <Modal visible={Boolean(recording)} transparent animationType="fade">
              <View style={styles.recordingBackdrop}>
                <View style={styles.recordingCard}>
                  <Text style={styles.blockTitle}>Đang ghi âm</Text>
                  <Text style={styles.subtle}>Nói nội dung thu/chi, rồi bấm kết thúc.</Text>
                  <View style={styles.waveRow}>
                    {[0, 1, 2, 3, 4, 5].map((idx) => (
                      <Animated.View
                        // Staggered transform to mimic audio wave
                        key={idx}
                        style={[
                          styles.waveBar,
                          {
                            transform: [
                              {
                                scaleY: waveAnim.interpolate({
                                  inputRange: [0, 0.25, 0.5, 0.75, 1],
                                  outputRange:
                                    idx % 2 === 0
                                      ? [0.6, 1.25, 0.7, 1.15, 0.6]
                                      : [1.1, 0.65, 1.2, 0.75, 1.1],
                                }),
                              },
                            ],
                          },
                        ]}
                      />
                    ))}
                  </View>
                  <Pressable style={styles.primaryBtn} onPress={onStopVoiceRecording}>
                    <Text style={styles.primaryBtnText}>Kết thúc ghi âm</Text>
                  </Pressable>
                </View>
              </View>
            </Modal>

            {showDatePicker && Platform.OS === 'android' ? (
              <DateTimePicker
                value={datePickerValue}
                mode="date"
                display="default"
                themeVariant={theme}
                onChange={onDatePicked}
              />
            ) : null}

            <Modal visible={showDatePicker && Platform.OS === 'ios'} transparent animationType="fade">
              <View style={styles.loadingBackdrop}>
                <View style={styles.dateModalCard}>
                  <View style={styles.lineRowNoBorder}>
                    <Pressable onPress={closeDatePicker}><Text style={styles.subtle}>Hủy</Text></Pressable>
                    <Pressable onPress={applyDatePicker}><Text style={styles.success}>Xong</Text></Pressable>
                  </View>
                  <DateTimePicker value={datePickerDraft} mode="date" display="spinner" themeVariant={theme} onChange={onDatePicked} />
                </View>
              </View>
            </Modal>
          </>
        )}
      </SafeAreaView>
  );
}

function Chip({
  label,
  active,
  onPress,
  palette,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  palette: typeof dark;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        borderWidth: 1,
        borderColor: active ? palette.accent : palette.border,
        borderRadius: 14,
        paddingVertical: 11,
        alignItems: 'center',
        backgroundColor: active ? palette.muted : 'transparent',
      }}
    >
      <Text style={{ color: palette.text, fontWeight: '700', fontSize: 17 }}>{label}</Text>
    </Pressable>
  );
}

function TypeSwitch({
  current,
  onChange,
  incomeLabel,
  expenseLabel,
  palette,
}: {
  current: TransactionType;
  onChange: (v: TransactionType) => void;
  incomeLabel: string;
  expenseLabel: string;
  palette: typeof dark;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
      <Chip label={expenseLabel} active={current === 'expense'} onPress={() => onChange('expense')} palette={palette} />
      <Chip label={incomeLabel} active={current === 'income'} onPress={() => onChange('income')} palette={palette} />
    </View>
  );
}

function MiniChip({
  label,
  active,
  onPress,
  styles,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.miniChip, active && styles.miniChipActive]}>
      <Text style={[styles.miniChipText, active && styles.miniChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function DonutChart({
  size,
  strokeWidth,
  segments,
  trackColor,
}: {
  size: number;
  strokeWidth: number;
  segments: Array<{ value: number; color: string }>;
  trackColor: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  let offset = 0;

  return (
    <Svg width={size} height={size}>
      <Circle cx={center} cy={center} r={radius} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
      {total > 0
        ? segments.map((segment, idx) => {
            const pct = Math.max(0, segment.value) / total;
            const strokeDasharray = `${pct * circumference} ${circumference}`;
            const strokeDashoffset = -offset * circumference;
            offset += pct;
            return (
              <Circle
                key={`${segment.color}-${idx}`}
                cx={center}
                cy={center}
                r={radius}
                stroke={segment.color}
                strokeWidth={strokeWidth}
                fill="none"
                strokeDasharray={strokeDasharray}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                transform={`rotate(-90 ${center} ${center})`}
              />
            );
          })
        : null}
    </Svg>
  );
}

function TabButton({ icon, label, active, onPress, styles, palette }: { icon: keyof typeof Ionicons.glyphMap; label: string; active: boolean; onPress: () => void; styles: ReturnType<typeof makeStyles>; palette: typeof dark }) {
  return (
    <Pressable onPress={onPress} style={styles.tabBtn}>
      <Ionicons name={icon} size={20} color={active ? palette.accent : palette.sub} />
      <Text numberOfLines={1} style={[styles.tabText, active && { color: palette.accent, fontWeight: '700' }]}>{label}</Text>
    </Pressable>
  );
}

function makeStyles(c: typeof dark) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    topBar: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 },
    appTitle: { color: c.text, fontSize: 38, fontWeight: '800', letterSpacing: -0.8 },
    main: { flex: 1 },
    page: { flex: 1, paddingHorizontal: 16 },
    pagePad: { paddingBottom: 100, gap: 12 },
    centerWrap: { flex: 1, padding: 16, justifyContent: 'center', gap: 10 },
    authTitle: { color: c.text, fontSize: 38, fontWeight: '800', letterSpacing: -0.8 },
    subtle: { color: c.sub, fontSize: 13 },
    balanceCard: {
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 30,
      padding: 16,
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },
        android: { elevation: 8 },
      }),
    },
    balanceText: { color: c.text, fontSize: 42, fontWeight: '800', letterSpacing: -0.8 },
    statCard: { flex: 1, backgroundColor: c.muted, borderRadius: 16, padding: 12 },
    blockCard: {
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 28,
      padding: 16,
      gap: 8,
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 15, shadowOffset: { width: 0, height: 8 } },
        android: { elevation: 6 },
      }),
    },
    homeMiniRow: { flexDirection: 'row', gap: 10 },
    accountListCard: {
      flex: 1.25,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 22,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 6,
    },
    fxCard: {
      flex: 1,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 22,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 2,
    },
    blockTitle: { color: c.text, fontSize: 20, fontWeight: '700' },
    smallBlockTitle: { color: c.text, fontSize: 16, fontWeight: '700' },
    lineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: c.border, paddingVertical: 8 },
    lineRowNoBorder: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8 },
    lineText: { color: c.text, fontSize: 17 },
    lineTextShrink: { color: c.text, fontSize: 17, flex: 1, paddingRight: 10 },
    fxStrong: { color: c.accent, fontSize: 12, fontWeight: '700' },
    fxTiny: { color: c.sub, fontSize: 10 },
    accountChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    accountChip: {
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.muted,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
      maxWidth: 120,
    },
    accountChipActive: { borderColor: c.accent },
    accountChipText: { color: c.sub, fontSize: 12, fontWeight: '600' },
    accountChipTextActive: { color: c.accent },
    headerText: { color: c.text, fontSize: 28, fontWeight: '800', marginTop: 4, letterSpacing: -0.3 },
    txCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 24, padding: 14, flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    txLeft: { flex: 1, paddingRight: 10 },
    txName: { color: c.text, fontSize: 18, fontWeight: '600', lineHeight: 24 },
    txRight: { alignItems: 'flex-end', justifyContent: 'space-between', minWidth: 110, maxWidth: 150 },
    amountText: { flexShrink: 1, textAlign: 'right' },
    success: { color: c.accent, fontWeight: '700' },
    danger: { color: c.danger, fontWeight: '700' },
    input: { backgroundColor: c.muted, borderWidth: 1, borderColor: c.border, borderRadius: 16, color: c.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 18 },
    inputBig: { backgroundColor: c.muted, borderWidth: 1, borderColor: c.border, borderRadius: 20, color: c.text, paddingHorizontal: 14, paddingVertical: 14, fontSize: 28, fontWeight: '700' },
    primaryBtn: { backgroundColor: c.accent, borderRadius: 18, alignItems: 'center', paddingVertical: 13 },
    primaryBtnText: { color: c.bg, fontWeight: '800', fontSize: 20 },
    ghostBtn: { flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 16, paddingVertical: 11, alignItems: 'center', backgroundColor: c.muted },
    ghostText: { color: c.text, fontWeight: '700' },
    formLabel: { color: c.text, fontSize: 14, fontWeight: '700', marginTop: 4 },
    formHint: { color: c.sub, fontSize: 12, marginTop: -2 },
    segmentWrap: { flexDirection: 'row', gap: 8, marginTop: 2 },
    segmentBtn: {
      flex: 1,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 14,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.muted,
    },
    segmentBtnActive: { borderColor: c.accent, backgroundColor: c.card },
    segmentText: { color: c.sub, fontWeight: '700' },
    segmentTextActive: { color: c.text },
    composerInput: {
      backgroundColor: c.muted,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 16,
      color: c.text,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 20,
      fontWeight: '600',
      minHeight: 68,
    },
    quickActionBtn: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 16,
      paddingVertical: 10,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.muted,
      minWidth: 116,
    },
    rowGap: { flexDirection: 'row', gap: 8 },
    rowGapWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    dateBtn: { justifyContent: 'center', minHeight: 44 },
    dateText: { color: c.text, fontWeight: '600' },
    datePlaceholder: { color: c.sub },
    attachRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
    attachText: { color: c.accent, fontWeight: '700' },
    miniChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.muted },
    miniChipActive: { borderColor: c.accent, backgroundColor: c.card },
    miniChipText: { color: c.sub, fontSize: 14, fontWeight: '600' },
    miniChipTextActive: { color: c.accent },
    donutWrap: { alignItems: 'center', justifyContent: 'center', marginVertical: 8 },
    donutCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26 },
    donutValue: { color: c.text, fontWeight: '700', fontSize: 14, textAlign: 'center' },
    donutLabel: { color: c.sub, fontSize: 12, marginTop: 2 },
    catRow: { gap: 6, marginTop: 2 },
    catTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
    catName: { color: c.text, fontWeight: '600', flex: 1 },
    catAmount: { color: c.sub, fontSize: 13, maxWidth: 180, textAlign: 'right' },
    catTrack: { width: '100%', height: 10, borderRadius: 999, backgroundColor: c.muted, overflow: 'hidden' },
    catFill: { height: 10, borderRadius: 999, backgroundColor: c.accent },
    bottomNav: { height: 84, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.overlay, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
    tabBtn: { alignItems: 'center', width: 72 },
    tabText: { color: c.sub, fontSize: 11, marginTop: 2 },
    fab: {
      width: 62,
      height: 62,
      borderRadius: 31,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: -28,
      ...Platform.select({
        ios: { shadowColor: c.accent, shadowOpacity: 0.45, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
        android: { elevation: 10 },
      }),
    },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
    modalCard: { backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 14, gap: 8, borderWidth: 1, borderColor: c.border },
    receiptWrap: { gap: 8 },
    receiptImage: { width: '100%', height: 220, borderRadius: 10, backgroundColor: c.muted },
    receiptViewerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', alignItems: 'center', justifyContent: 'center', padding: 16 },
    receiptViewerImage: { width: '100%', height: '82%' },
    receiptViewerClose: {
      position: 'absolute',
      top: 56,
      right: 16,
      zIndex: 10,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 999,
      paddingVertical: 8,
      paddingHorizontal: 14,
      backgroundColor: c.muted,
    },
    accountRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10, gap: 8 },
    accountMain: { flex: 1 },
    settingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: c.border,
      minHeight: 52,
      paddingVertical: 10,
    },
    settingLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    settingIconWrap: {
      width: 26,
      height: 26,
      borderRadius: 8,
      backgroundColor: c.muted,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    panelBody: { gap: 8, paddingBottom: 6 },
    iconBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.muted,
    },
    logoutBtn: { borderWidth: 1, borderColor: c.danger, borderRadius: 14, alignItems: 'center', paddingVertical: 11, backgroundColor: c.muted },
    logoutText: { color: c.danger, fontWeight: '700' },
    loadingBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center' },
    loadingCard: {
      minWidth: 170,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
      alignItems: 'center',
      paddingVertical: 18,
      paddingHorizontal: 16,
      gap: 10,
    },
    dateModalCard: {
      width: '88%',
      borderRadius: 20,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
      padding: 12,
    },
    recordingBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
    recordingCard: {
      width: '86%',
      borderRadius: 22,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
      padding: 16,
      gap: 12,
    },
    waveRow: { height: 44, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7 },
    waveBar: { width: 7, height: 26, borderRadius: 999, backgroundColor: c.accent },
    loadingText: { color: c.text, fontWeight: '600' },
    authLinkWrap: { alignItems: 'center', paddingTop: 2, paddingBottom: 4 },
    authLinkText: { color: c.accent, fontWeight: '600' },
  });
}
