// Fonction Vercel : POST /api/agent (voir server/agent/web.js).
import { serve } from '../server/http.js';

export default (req, res) => serve('agent', req, res);
