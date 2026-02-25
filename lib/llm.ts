import { Currency, Language, ParsedTransaction, TransactionType } from '../types/finance';

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const AI_PROXY_URL = process.env.EXPO_PUBLIC_AI_PROXY_URL?.trim();
const GEMINI_MODEL = process.env.EXPO_PUBLIC_GEMINI_MODEL?.trim();
const GEMINI_FALLBACK_MODELS = process.env.EXPO_PUBLIC_GEMINI_FALLBACK_MODELS?.trim();

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_FALLBACKS = ['gemini-2.5-flash-lite'];

function buildEndpoint(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function getModelChain(): string[] {
  const primary = GEMINI_MODEL && GEMINI_MODEL.length > 0 ? GEMINI_MODEL : DEFAULT_MODEL;
  const fallbacks = GEMINI_FALLBACK_MODELS
    ? GEMINI_FALLBACK_MODELS.split(',')
        .map((m: string) => m.trim())
        .filter(Boolean)
    : DEFAULT_FALLBACKS;

  return [primary, ...fallbacks].filter((m, i, arr) => arr.indexOf(m) === i);
}

function assertKey(): string {
  if (!GEMINI_API_KEY) {
    throw new Error('Missing EXPO_PUBLIC_GEMINI_API_KEY in .env');
  }
  return GEMINI_API_KEY;
}

function cleanJson(text: string): string {
  return text.replace(/```json/gi, '').replace(/```/g, '').trim();
}

function extractTextFromGemini(response: GeminiResponse): string {
  const text = response.candidates
    ?.flatMap((c) => c.content?.parts ?? [])
    .map((p) => p.text)
    .find((x): x is string => Boolean(x));

  if (!text) {
    throw new Error('Gemini response did not contain text output.');
  }

  return text;
}

function pickMimeType(uri: string, kind: 'audio' | 'image'): string {
  const lower = uri.toLowerCase();
  if (kind === 'audio') {
    if (lower.endsWith('.wav')) return 'audio/wav';
    if (lower.endsWith('.mp3')) return 'audio/mpeg';
    if (lower.endsWith('.aac')) return 'audio/aac';
    if (lower.endsWith('.m4a')) return 'audio/mp4';
    return 'audio/mp4';
  }

  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function uriToBase64(uri: string, maxBytes?: number): Promise<string> {
  const res = await fetch(uri);
  if (!res.ok) {
    throw new Error('Failed to read local media file');
  }

  const blob = await res.blob();
  if (maxBytes && blob.size > maxBytes) {
    throw new Error(
      `Media file is too large (${(blob.size / 1024 / 1024).toFixed(1)}MB). Please crop/compress and retry with a smaller file.`,
    );
  }
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Unable to convert media to base64'));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error('Unable to convert media to base64'));
    reader.readAsDataURL(blob);
  });

  const base64 = dataUrl.split(',')[1];
  if (!base64) {
    throw new Error('Invalid base64 media data');
  }

  return base64;
}

async function callGemini(parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }>): Promise<string> {
  const modelChain = getModelChain();
  if (AI_PROXY_URL) {
    const res = await fetch(AI_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parts,
        model: modelChain[0],
        fallbackModels: modelChain.slice(1),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`AI proxy request failed (status=${res.status}): ${errText}`);
    }

    const payload = (await res.json()) as { text?: string };
    if (!payload.text) {
      throw new Error('AI proxy response missing text output.');
    }
    return payload.text;
  }

  const key = assertKey();
  let lastError: Error | null = null;
  for (const model of modelChain) {
    const endpoint = buildEndpoint(model);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseMimeType: 'text/plain',
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      const status = res.status;
      const mayRetryOnOtherModel = status === 429 || status >= 500;

      lastError = new Error(`Gemini request failed (model=${model}, status=${status}): ${errText}`);
      if (mayRetryOnOtherModel) {
        continue;
      }

      throw lastError;
    }

    const json = (await res.json()) as GeminiResponse;
    return extractTextFromGemini(json);
  }

  throw lastError ?? new Error('Gemini request failed for all configured models.');
}

export function hasLLMConfig(): boolean {
  return Boolean(AI_PROXY_URL || GEMINI_API_KEY);
}

export async function transcribeAudio(uri: string, language: Language): Promise<string> {
  // Keep under common serverless request limits after base64 expansion.
  const base64 = await uriToBase64(uri, 1_700_000);
  const mimeType = pickMimeType(uri, 'audio');
  const prompt =
    language === 'vi'
      ? 'Hãy chép lại chính xác nội dung giọng nói trong audio. Chỉ trả về phần transcript, không thêm giải thích.'
      : 'Please transcribe the spoken audio exactly. Return only the transcript text.';

  return callGemini([
    { text: prompt },
    {
      inline_data: {
        mime_type: mimeType,
        data: base64,
      },
    },
  ]);
}

export async function extractReceiptText(imageUri: string, language: Language): Promise<string> {
  // Keep under common serverless request limits after base64 expansion.
  const base64 = await uriToBase64(imageUri, 1_700_000);
  const mimeType = pickMimeType(imageUri, 'image');
  const prompt =
    language === 'vi'
      ? 'Đọc hóa đơn và trả về 1 câu ngắn gồm món/merchant + số tiền + tiền tệ + ngày. Ví dụ: "an com 50000 vnd hom nay".'
      : 'Read this receipt and return one short sentence with merchant/item + amount + currency + date. Example: "grocery 12 usd today".';

  return callGemini([
    { text: prompt },
    {
      inline_data: {
        mime_type: mimeType,
        data: base64,
      },
    },
  ]);
}

export async function normalizeTextToTransaction(
  raw: string,
  language: Language,
  fallbackCurrency: Currency,
  preferredType?: TransactionType,
): Promise<ParsedTransaction> {
  const instruction =
    language === 'vi'
      ? [
          'Chuẩn hóa dữ liệu chi tiêu thành JSON.',
          'Hiểu tiếng lóng như: k=nghìn, tr/củ/chai=triệu, xị=100k.',
          'Nếu thiếu thông tin, suy luận hợp lý.',
          'Trả về JSON duy nhất với keys: type, amount, currency, category, merchant, date, note, rawInput.',
          'Date phải là YYYY-MM-DD.',
          'currency chỉ được là USD hoặc VND.',
          'type chỉ được là income hoặc expense.',
        ].join(' ')
      : [
          'Normalize personal finance input into JSON.',
          'Understand slang/shorthand such as k=thousand, tr/mil=million.',
          'Infer missing fields reasonably.',
          'Return only JSON with keys: type, amount, currency, category, merchant, date, note, rawInput.',
          'Date must be YYYY-MM-DD.',
          'currency must be USD or VND.',
          'type must be income or expense.',
        ].join(' ');

  const output = await callGemini([
    {
      text: `${instruction}\nlanguage=${language}; defaultCurrency=${fallbackCurrency}; preferredType=${preferredType ?? 'none'}; input=${raw}`,
    },
  ]);

  const parsed = JSON.parse(cleanJson(output)) as Partial<ParsedTransaction>;
  if (!parsed.amount || !parsed.currency || !parsed.type) {
    throw new Error('Gemini output missing required fields');
  }

  return {
    type: parsed.type,
    amount: Number(parsed.amount),
    currency: parsed.currency,
    category: parsed.category ?? (parsed.type === 'income' ? 'Other Income' : 'Other Expense'),
    merchant: parsed.merchant,
    date: parsed.date ?? new Date().toISOString().slice(0, 10),
    note: parsed.note ?? raw,
    inputMode: parsed.inputMode ?? 'text',
    rawInput: parsed.rawInput ?? raw,
  };
}

type GeminiPart = {
  text?: string;
};

type GeminiCandidate = {
  content?: {
    parts?: GeminiPart[];
  };
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
};
