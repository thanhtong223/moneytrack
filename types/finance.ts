export type InputMode = 'text' | 'voice' | 'image' | 'manual';
export type TransactionType = 'income' | 'expense';
export type Language = 'en' | 'vi';
export type Currency = 'USD' | 'VND';
export type ThemeMode = 'dark' | 'light';

export type Account = {
  id: string;
  name: string;
  currency: Currency;
  createdAt: string;
};

export type Transaction = {
  id: string;
  accountId: string;
  type: TransactionType;
  amount: number;
  currency: Currency;
  category: string;
  merchant?: string;
  date: string;
  note?: string;
  receiptUri?: string;
  receiptType?: 'image' | 'pdf' | 'text';
  receiptName?: string;
  inputMode: InputMode;
  rawInput: string;
  createdAt: string;
};

export type ParsedTransaction = Omit<Transaction, 'id' | 'createdAt' | 'accountId'>;

export type AppSettings = {
  language: Language;
  defaultCurrency: Currency;
  theme: ThemeMode;
  onboardingCompleted: boolean;
  defaultAccountId?: string;
};
