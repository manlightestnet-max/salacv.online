// Fonction Vercel : POST /api/login (voir server/agent/web.js).
import { serve } from '../server/http.js';

export default (req, res) => serve('login', req, res);
