// Fonction Vercel : POST /api/google (voir server/agent/web.js).
import { serve } from '../server/http.js';

export default (req, res) => serve('google', req, res);
