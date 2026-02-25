const DEFAULT_PRIMARY_MODEL = 'gemini-2.5-flash-lite';
const DEFAULT_FALLBACK_MODELS = ['gemini-3-flash', 'gemini-2.5-flash'];

function extractTextFromGemini(response) {
  const text = response?.candidates
    ?.flatMap((c) => c?.content?.parts ?? [])
    ?.map((p) => p?.text)
    ?.find(Boolean);

  if (!text) {
    throw new Error('Gemini response did not contain text output.');
  }
  return text;
}

function parseModelChain(body) {
  const requestedPrimary = typeof body?.model === 'string' ? body.model.trim() : '';
  const requestedFallbacks = Array.isArray(body?.fallbackModels)
    ? body.fallbackModels.filter((m) => typeof m === 'string').map((m) => m.trim()).filter(Boolean)
    : [];

  const chain = [requestedPrimary || DEFAULT_PRIMARY_MODEL, ...requestedFallbacks, ...DEFAULT_FALLBACK_MODELS];
  return chain.filter((m, i) => chain.indexOf(m) === i);
}

async function callGeminiWithFallback(parts, modelChain, key) {
  let lastError = null;

  for (const model of modelChain) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'text/plain' },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      lastError = new Error(`Gemini request failed (model=${model}, status=${res.status}): ${errText}`);
      const canFallback = res.status === 429 || res.status >= 500;
      if (canFallback) continue;
      throw lastError;
    }

    const json = await res.json();
    return { text: extractTextFromGemini(json), modelUsed: model };
  }

  throw lastError ?? new Error('All Gemini models failed.');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Missing GEMINI_API_KEY in server environment.' });
  }

  const parts = req.body?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return res.status(400).json({ error: 'Invalid payload: "parts" must be a non-empty array.' });
  }

  const modelChain = parseModelChain(req.body);

  try {
    const { text, modelUsed } = await callGeminiWithFallback(parts, modelChain, key);
    return res.status(200).json({ text, modelUsed });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gemini proxy failed.';
    return res.status(502).json({ error: message });
  }
}
