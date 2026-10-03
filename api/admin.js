// Fonction Vercel : POST /api/admin (voir server/http.js).
import { serve } from '../server/http.js';

export default (req, res) => serve('admin', req, res);
