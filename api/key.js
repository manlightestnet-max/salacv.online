// Fonction Vercel : POST /api/key (voir server/agent/web.js).
import { serve } from '../server/http.js';

export default (req, res) => serve('key', req, res);
