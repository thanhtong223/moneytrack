# MoneyTrack MVP (Expo SDK 54)

## Core features
- Auth: username/password (local)
- User-isolated data (each login has separate local wallets/transactions/settings)
- First launch onboarding per user:
  - language
  - primary currency
  - dark/light theme
- Bottom nav: Home, Transactions, Add, Account
- Add with 2 input modes:
  - Manual mode: local parser only (no API)
  - AI mode: text/voice/image use Gemini API
- Receipt support: image, PDF, TXT
- Mixed-currency handling: totals/lists convert USD<->VND to the user primary currency using latest USD/VND rate

## Setup
1. Install dependencies
```bash
npm install
```

2. Create env
```bash
cp .env.example .env
```

3. Fill `.env`
```bash
EXPO_PUBLIC_AI_PROXY_URL=https://your-proxy-domain/api/gemini
EXPO_PUBLIC_GEMINI_MODEL=gemini-2.5-flash-lite
EXPO_PUBLIC_GEMINI_FALLBACK_MODELS=gemini-3-flash,gemini-2.5-flash
```

4. Start app
```bash
npx expo start -c
```

5. Configure Supabase (required for auth + data persistence)
1. Open Supabase SQL Editor and run:
```bash
supabase/schema.sql
```
2. In Supabase Auth settings, disable email confirmation for this username/password MVP flow.

## Important
- Local auth is for MVP only (not production secure).
- `EXPO_PUBLIC_*` keys are visible in client app. Do not put private API keys in `EXPO_PUBLIC_*`.

## Secure Gemini Proxy (Recommended)
This repo includes a server endpoint at `api/gemini.js` for secure Gemini access.

### A) Deploy proxy to Vercel
1. Push repo to GitHub.
2. Import this repo in Vercel.
3. In Vercel project settings -> Environment Variables, add:
```bash
GEMINI_API_KEY=your_private_key_here
```
4. Deploy. Your endpoint URL will be:
```bash
https://<your-vercel-domain>/api/gemini
```

### B) Configure app to use proxy
In local `.env`, set:
```bash
EXPO_PUBLIC_AI_PROXY_URL=https://<your-vercel-domain>/api/gemini
EXPO_PUBLIC_GEMINI_MODEL=gemini-2.5-flash-lite
EXPO_PUBLIC_GEMINI_FALLBACK_MODELS=gemini-3-flash,gemini-2.5-flash
```

Optional fallback for local development only:
```bash
# Avoid direct client keys in production.
# Keep Gemini key on server only (GEMINI_API_KEY in proxy project).
```
If `EXPO_PUBLIC_AI_PROXY_URL` is set, app will use proxy first.

### C) Restart app
```bash
npx expo start -c
```
