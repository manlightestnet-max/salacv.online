// Fonction Vercel : POST /api/templates (voir server/http.js).
import { serve } from '../server/http.js';

export default (req, res) => serve('templates', req, res);
