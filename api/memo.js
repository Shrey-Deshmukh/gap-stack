// Vercel function: POST /api/memo (Claude memo if ANTHROPIC_API_KEY is set, else template)
import { memo } from '../lib/core.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    res.status(200).json(await memo(body));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
