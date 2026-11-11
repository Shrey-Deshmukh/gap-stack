// Vercel function: GET /api/health
import { health } from '../lib/core.mjs';

export default function handler(req, res) {
  res.setHeader('cache-control', 'no-cache');
  res.status(200).json(health());
}
