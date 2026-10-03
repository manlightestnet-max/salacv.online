// Fonction Vercel : POST /api/collect (voir server/http.js).
import { serve } from '../server/http.js';

export default (req, res) => serve('collect', req, res);
