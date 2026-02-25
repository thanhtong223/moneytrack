import { Currency, InputMode, Language, ParsedTransaction, TransactionType } from '../types/finance';

const incomeKeywords = [
  'salary',
  'income',
  'bonus',
  'freelance',
  'received',
  'lương',
  'thu',
  'thưởng',
  'được trả',
  'chuyển khoản vào',
];

const expenseKeywords = [
  'spent',
  'pay',
  'bought',
  'bill',
  'rent',
  'cafe',
  'coffee',
  'ăn',
  'mua',
  'chi',
  'tiền nhà',
  'xăng',
  'grab',
  'ăn trưa',
  'an com',
];

const categoryRules: Array<{ re: RegExp; en: string; vi: string }> = [
  { re: /(coffee|cafe|trà|tea|ăn|com|food|grocery|siêu thị)/i, en: 'Food', vi: 'Ăn uống' },
  { re: /(rent|tiền nhà|nhà)/i, en: 'Housing', vi: 'Nhà ở' },
  { re: /(grab|uber|xăng|bus|taxi|transport)/i, en: 'Transport', vi: 'Di chuyển' },
  { re: /(salary|lương|bonus|thưởng|freelance)/i, en: 'Salary', vi: 'Thu nhập' },
  { re: /(bill|internet|điện|nước|phone)/i, en: 'Utilities', vi: 'Hóa đơn' },
];

function detectCurrency(text: string, fallback: Currency): Currency {
  const lower = text.toLowerCase();
  if (/(\$|usd|dollar)/.test(lower)) return 'USD';
  if (/(vnd|đ|k\b|tr\b|triệu|nghìn|ngan)/.test(lower)) return 'VND';
  return fallback;
}

function parseAmount(raw: string, currency: Currency): number | null {
  const lower = raw.toLowerCase().replace(/,/g, '.');

  const shorthandMatch = lower.match(/(\d+(?:\.\d+)?)\s*(k|tr|m|mil|xị|cu|củ|chai)\b/);
  if (shorthandMatch) {
    const base = Number(shorthandMatch[1]);
    const unit = shorthandMatch[2];
    if (['k', 'xị'].includes(unit)) return base * 1_000;
    if (['tr', 'củ', 'cu', 'chai'].includes(unit)) return base * 1_000_000;
    if (['m', 'mil'].includes(unit)) return currency === 'VND' ? base * 1_000_000 : base * 1_000_000;
  }

  const rawNum = lower.match(/(\d+(?:\.\d+)?)/);
  if (!rawNum) return null;

  const value = Number(rawNum[1]);
  if (Number.isNaN(value)) return null;

  if (currency === 'VND' && value < 1000 && /(ăn|cafe|grab|com|trà|tea|mua)/.test(lower)) {
    return value * 1_000;
  }

  return value;
}

function detectType(text: string, preferred?: TransactionType): TransactionType {
  if (preferred) return preferred;
  const lower = text.toLowerCase();
  if (incomeKeywords.some((k) => lower.includes(k))) return 'income';
  if (expenseKeywords.some((k) => lower.includes(k))) return 'expense';
  return 'expense';
}

function detectCategory(text: string, language: Language, type: TransactionType): string {
  const matched = categoryRules.find((r) => r.re.test(text));
  if (matched) return language === 'vi' ? matched.vi : matched.en;
  if (type === 'income') return language === 'vi' ? 'Thu khác' : 'Other Income';
  return language === 'vi' ? 'Chi khác' : 'Other Expense';
}

function normalizeDate(text: string): string {
  const lower = text.toLowerCase();
  const now = new Date();
  if (/(yesterday|hôm qua|hom qua)/.test(lower)) {
    now.setDate(now.getDate() - 1);
    return now.toISOString().slice(0, 10);
  }
  if (/(today|hôm nay|hom nay)/.test(lower)) {
    return now.toISOString().slice(0, 10);
  }

  const iso = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];

  const slash = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const year = slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : now.getFullYear();
    return new Date(year, month - 1, day).toISOString().slice(0, 10);
  }

  return now.toISOString().slice(0, 10);
}

export function parseTransactionInput(
  rawInput: string,
  inputMode: InputMode,
  language: Language,
  fallbackCurrency: Currency,
  preferredType?: TransactionType,
): ParsedTransaction {
  const currency = detectCurrency(rawInput, fallbackCurrency);
  const amount = parseAmount(rawInput, currency);
  if (!amount || Number.isNaN(amount)) {
    throw new Error(language === 'vi' ? 'Không tìm thấy số tiền hợp lệ.' : 'Could not find a valid amount.');
  }

  const type = detectType(rawInput, preferredType);
  const category = detectCategory(rawInput, language, type);

  return {
    type,
    amount,
    currency,
    category,
    merchant: undefined,
    date: normalizeDate(rawInput),
    note: rawInput,
    inputMode,
    rawInput,
  };
}
