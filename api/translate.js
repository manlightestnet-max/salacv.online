// Fonction Vercel : POST /api/translate (voir server/agent/web.js).
import { serve } from '../server/http.js';

export default (req, res) => serve('translate', req, res);
