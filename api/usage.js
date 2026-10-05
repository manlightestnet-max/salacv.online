// Fonction Vercel : POST /api/usage (voir server/agent/web.js).
import { serve } from '../server/http.js';

export default (req, res) => serve('usage', req, res);
