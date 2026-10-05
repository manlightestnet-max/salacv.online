// Fonction Vercel : POST /api/config (voir server/keys/routes.js).
import { serve } from '../server/http.js';

export default (req, res) => serve('config', req, res);
