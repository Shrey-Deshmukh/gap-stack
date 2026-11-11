// Shared server logic for Gap Stack.
// Used by server.mjs (local / Render) and by the Vercel functions in api/.
// No dependencies. Node 18+.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MODEL = () => process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// In-memory cache for FRED rates (updates weekly; refresh every hour)
let ratesCache = null;
let ratesCachedAt = 0;

async function fetchLiveRates() {
  const key = process.env.FRED_API_KEY;
  if (!key) return null;
  if (ratesCache && Date.now() - ratesCachedAt < 3600_000) return ratesCache;
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=MORTGAGE30US&api_key=${key}&sort_order=desc&limit=104&file_type=json`;
    const r = await fetch(url);
    const body = await r.json();
    if (!r.ok) throw new Error(body.error_message || `FRED HTTP ${r.status}`);
    const obs = body.observations
      .filter((o) => o.value !== '.' && !isNaN(Number(o.value)))
      .map((o) => ({ date: o.date, rate30: Number(Number(o.value).toFixed(2)) }))
      .reverse();
    const latest = obs[obs.length - 1];
    ratesCache = {
      source: 'Freddie Mac PMMS 30-year fixed via FRED (Federal Reserve Bank of St. Louis)',
      source_url: 'https://fred.stlouisfed.org/series/MORTGAGE30US',
      checked: new Date().toISOString().slice(0, 10),
      latest: { date: latest.date, rate30: latest.rate30 },
      weekly_last_2y: obs,
    };
    ratesCachedAt = Date.now();
    return ratesCache;
  } catch (e) {
    console.error('FRED fetch failed:', e.message);
    return null;
  }
}

async function claude(system, user, maxTokens = 1400) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, reason: 'no_key' };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  const body = await res.json();
  if (!res.ok) return { ok: false, reason: body?.error?.message || `HTTP ${res.status}` };
  return { ok: true, text: body.content.map((c) => c.text || '').join(''), model: body.model };
}

const MEMO_SYSTEM = `You write one-page funder memos for a small Orange County nonprofit that builds for-sale affordable homes.
Rules that do not bend:
- Use ONLY the numbers in the JSON you are given. Never compute new totals, never invent a number, statute, program, fee or date.
- Any number whose tag is ASSUMPTION or SYNTHETIC must be written with "(assumption)" right after it.
- Programs with status funds_unconfirmed must be described as not yet confirmed. Programs with status unknown are listed as leads only.
- Cite sources inline in short form, e.g. (HCD 2026 State Income Limits, rev. 2026-06-23) or (HCD APR Table A2, n=23 projects).
- Plain English a board member understands. No em-dashes. Markdown with short headings: The ask, The gap, Why time matters, Who can fill it, What we still need to confirm.
- Under 330 words. End with the line: "Prototype output. Not financial or legal advice."`;

const PROGRAM_SYSTEM = `You turn the text of a housing funding program page into one JSON row for a funding-stack tool.
Return ONLY JSON with keys: name, type ("buyer" or "developer"), amount ({"kind":"fixed","value":N} or {"kind":"pct_price","value":0.xx,"cap":N} or {"kind":"unknown"}), terms (one sentence quoting the page), max_ami (number or null), cities (array of UPPERCASE city names or null), status ("confirmed" | "funds_unconfirmed" | "unknown"), status_note, evidence (array of short exact quotes from the text that support each number).
Never guess. If the text does not state an amount, amount.kind is "unknown". If the text does not say funds are open, status is "funds_unconfirmed" or "unknown".`;

function fallbackMemo(p) {
  const f = (v) => '$' + Math.round(v).toLocaleString('en-US');
  return `## The ask
We are building ${p.homes} for-sale homes in ${p.city} for families earning up to ${p.bandLabel}. We need ${f(p.fundraisingTotal)} in philanthropic support to close the project (${f(p.fundraisingPer)} per home).

## The gap
Each home costs ${f(p.costPer)} to create. Under HSC 50052.5(b) a qualifying family can pay about ${f(p.familyPer)} at today's ${p.rate}% rate (Freddie Mac PMMS, ${p.rateDate}; HCD 2026 State Income Limits, rev. 2026-06-23). That leaves a gap of ${f(p.gapPer)} per home.

## Why time matters
${p.timeLine}

## Who can fill it
${p.programLines}

## What we still need to confirm
Program funds marked unconfirmed, the cost lines (assumption), and carrying-cost inputs (assumption).

_Template memo: set ANTHROPIC_API_KEY to have Claude write this from the same numbers._

Prototype output. Not financial or legal advice.`;
}

/* ---------- route handlers: each returns a plain JSON-able object ---------- */

export function health() {
  return { ok: true, claude: Boolean(process.env.ANTHROPIC_API_KEY), model: MODEL(), fred: Boolean(process.env.FRED_API_KEY) };
}

/** Live FRED rates when FRED_API_KEY is set, otherwise the committed data/pmms.json. */
export async function rates(root) {
  const live = await fetchLiveRates();
  if (live) return live;
  return JSON.parse(readFileSync(join(root, 'data', 'pmms.json'), 'utf8'));
}

export async function memo(body = {}) {
  const r = await claude(MEMO_SYSTEM, 'Write the funder memo from this engine output:\n```json\n' + JSON.stringify(body.facts, null, 1) + '\n```');
  if (r.ok) return { memo: r.text, by: r.model };
  return { memo: fallbackMemo(body.template), by: 'template', reason: r.reason };
}

export async function program(body = {}) {
  const text = String(body.text || '').slice(0, 30000);
  const r = await claude(PROGRAM_SYSTEM, `Source URL: ${body.url || 'pasted text'}\n\nPage text:\n${text}`, 900);
  if (!r.ok) return { error: r.reason === 'no_key' ? 'Set ANTHROPIC_API_KEY to use the program reader.' : r.reason };
  const m = r.text.match(/\{[\s\S]*\}/);
  try { return { row: JSON.parse(m ? m[0] : r.text), by: r.model }; } catch { return { error: 'Claude did not return valid JSON', raw: r.text }; }
}
