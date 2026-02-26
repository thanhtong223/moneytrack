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
  { re: /(coffee|cafe|trà|tea|ăn|com|food|grocery|siêu thị|restaurant|bún|phở)/i, en: 'Food & Drink', vi: 'Ăn uống' },
  { re: /(rent|tiền nhà|nhà|apartment|hostel|mortgage)/i, en: 'Housing', vi: 'Nhà ở' },
  { re: /(grab|uber|xăng|bus|taxi|transport|petrol|fuel|vé|parking)/i, en: 'Transport', vi: 'Di chuyển' },
  { re: /(salary|lương|bonus|thưởng|freelance|payroll|income)/i, en: 'Salary', vi: 'Thu nhập' },
  { re: /(bill|internet|điện|nước|phone|wifi|electric)/i, en: 'Bills & Utilities', vi: 'Hóa đơn' },
  { re: /(shop|shopping|mall|mua đồ|quần áo|shopee|lazada)/i, en: 'Shopping', vi: 'Mua sắm' },
  { re: /(doctor|hospital|medicine|pharmacy|thuốc|khám)/i, en: 'Health', vi: 'Sức khỏe' },
  { re: /(movie|cinema|game|netflix|spotify|du lịch|travel|hotel)/i, en: 'Entertainment', vi: 'Giải trí' },
  { re: /(tuition|học|course|class|book|sách)/i, en: 'Education', vi: 'Giáo dục' },
];

function detectCurrency(text: string, fallback: Currency): Currency {
  const lower = text.toLowerCase();
  if (/(\$|usd|dollar)/.test(lower)) return 'USD';
  if (/(vnd|đ|k\b|tr\b|triệu|nghìn|ngan)/.test(lower)) return 'VND';
  return fallback;
}

function parseAmount(raw: string, currency: Currency): number | null {
  const lower = raw.toLowerCase();
  // Remove common date formats so year/day tokens do not get mistaken as price.
  const scrubbed = lower
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(/\b(?:ngày|day)\s+\d{1,2}\b/g, ' ');

  const unitMultiplier = (unit?: string): number => {
    if (!unit) return 1;
    if (['k', 'xị'].includes(unit)) return 1_000;
    if (['tr', 'củ', 'cu', 'chai', 'm', 'mil'].includes(unit)) return 1_000_000;
    return 1;
  };

  const parseNumberToken = (numText: string): number | null => {
    const compact = numText.replace(/\s/g, '');
    if (!compact) return null;

    // Thousands-like formats: 8.000.000 / 8,000,000
    if (/^\d{1,3}([.,]\d{3})+([.,]\d+)?$/.test(compact)) {
      const normalized = compact.replace(/[.,]/g, '');
      const value = Number(normalized);
      return Number.isNaN(value) ? null : value;
    }

    // Decimal-like formats: 12.5 / 12,5
    const normalized = compact.replace(',', '.');
    const value = Number(normalized);
    return Number.isNaN(value) ? null : value;
  };

  type Candidate = { amount: number; hasUnit: boolean };
  const candidates: Candidate[] = [];
  const tokenRe = /(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?:\s*)(k|tr|m|mil|xị|cu|củ|chai|vnd|đ|usd|\$)?/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(scrubbed)) !== null) {
    const parsedNum = parseNumberToken(match[1]);
    if (!parsedNum) continue;
    const unit = match[2];
    const amount = parsedNum * unitMultiplier(unit);
    candidates.push({ amount, hasUnit: Boolean(unit) });
  }

  if (candidates.length === 0) return null;

  // Prefer tokens that have explicit money unit/currency marker.
  const withUnits = candidates.filter((c) => c.hasUnit);
  let value = (withUnits.length > 0 ? withUnits : candidates).reduce((best, cur) => (cur.amount > best ? cur.amount : best), 0);

  if (currency === 'VND' && value < 1000 && /(ăn|cafe|grab|com|trà|tea|mua)/.test(lower)) {
    value *= 1_000;
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
