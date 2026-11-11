// Vercel function: GET /api/rates (live FRED if FRED_API_KEY is set, else data/pmms.json)
import { rates } from '../lib/core.mjs';

export default async function handler(req, res) {
  try {
    res.setHeader('cache-control', 'no-cache');
    res.status(200).json(await rates(process.cwd()));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
