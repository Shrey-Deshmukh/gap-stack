// Vercel function: POST /api/program (Claude program reader; needs ANTHROPIC_API_KEY)
import { program } from '../lib/core.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    res.status(200).json(await program(body));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
