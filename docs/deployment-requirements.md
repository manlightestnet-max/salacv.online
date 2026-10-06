# Deployment requirements — SalaCv

Liste établie à partir du code (`server/`, `api/`, `vite.config.js`, `app/auth.js`, `electron/main.cjs`).

## 1. Variables d'environnement (Vercel ou VPS)

### Obligatoires en production

| Variable | Lue dans | Rôle | Comment l'obtenir |
|---|---|---|---|
| `DATABASE_URL` | `server/db/index.js:39` | Base Postgres Neon (sans elle : PGlite local) | Console Neon > Project > Connect > chaîne avec `sslmode=require` |
| `SALACV_MASTER_KEY` | `server/crypto.js:11`, `http.js:105`, `agent/auth.js:23` | Chiffre les secrets ; repli pour signer les sessions | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (32 octets, base64) |
| `SALACV_ADMIN_UID` | `server/admin.js:81,90,100,112` | UID Firebase de l'administrateur ; sans lui l'admin est fermée (503) | Console Firebase > Authentication > Utilisateurs > « UID de l'utilisateur » |
| `VITE_FIREBASE_API_KEY` | `app/auth.js:42` | Clé web Firebase (injectée au build) | Console Firebase > Paramètres du projet > Vos applications > config web |

### Recommandées

| Variable | Lue dans | Rôle | Comment l'obtenir |
|---|---|---|---|
| `SALACV_SESSION_SECRET` | `server/agent/auth.js:22`, `feedback.js:9` | Signe les sessions, hache les IP des avis (repli : clé maître) | Même commande que la clé maître |

### Facultatives (valeurs par défaut)

| Variable | Défaut | Rôle |
|---|---|---|
| `FIREBASE_PROJECT_ID` (`accounts/firebase.js:7`) | `lightpay-a5f01` | Vérification des jetons Google |
| `VITE_FIREBASE_AUTH_DOMAIN` (`app/auth.js:43`) | `lightpay-a5f01.firebaseapp.com` | Domaine d'authentification |
| `VITE_FIREBASE_PROJECT_ID` (`app/auth.js:44`) | `lightpay-a5f01` | ID projet côté client |
| `PORT` (`server/index.js:60`) | `3000` | Port du serveur (VPS) |
| `AGENT_MAX_ITERATIONS` | `8` | Itérations max de l'agent |
| `AGENT_TIMEOUT` | `25` (s) | Délai d'appel au modèle |
| `AGENT_CONCURRENCY` | `8` | Requêtes agent simultanées par process |
| `AGENT_RATE_PER_MINUTE` | `6` | Limite par minute |
| `<NOM>_API_KEY(S)`, `<NOM>_BASE_URL`, `<NOM>_MODEL` (`OLLAMA`, `GEMINI`, `GROQ`) | — | Clés IA par variables ; elles peuvent aussi être gérées depuis l'admin |

### Desktop (Electron)

| Variable | Défaut | Rôle |
|---|---|---|
| `SALACV_AUTH_ORIGIN` (`electron/main.cjs:20`) | `https://smlab-theta.vercel.app` | Origine utilisée pour la connexion Google |

### Local / tests uniquement — jamais en production

`SALACV_ALLOW_PASSWORD_LOGIN` (`http.js:62`), `SALACV_DEMO_PASSWORD` (`agent/auth.js:51`), `SALACV_DATA_DIR`, `SALACV_DB` (`db/index.js:39`), `KEYGEN_PRIVATE_KEY_FILE` (`scripts/keygen.js:44`).

### Fournies automatiquement

`VERCEL`, `NODE_ENV` (`crypto.js:18`, `identity.js:41,68`) : active le mode production et les cookies `Secure`.

## 2. Réglages dans l'admin salacv (stockés en base, pas en variables)

- **LightPay** : clés sandbox et production, payee, `appId`, URLs, mode (`lightpay.*`, `server/shop.js:63`).
- **R2** : `r2.accountId`, `r2.accessKeyId`, `r2.secretAccessKey`, `r2.bucket` (`server/r2.js:13`).
- **Firebase** : l'admin n'affiche que l'état de la clé maître et de l'UID admin (`admin.js:155`).
- **Prix des packs, quotas, clés IA** (`server/keys/pool.js`).

## 3. Points d'attention

- **Upstash n'est plus utilisé.** `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN` ne sont lues nulle part : `store()` (`server/store.js`) passe par Postgres (`pgStore()`). Les prix des packs, le wallet LightPay et le journal de l'admin sont donc dans Neon. Le message de `app/admin.js:95` est périmé.
- **`envDir: '..'`** (`vite.config.js:6`) : Vite cherche les `VITE_*` dans `C:\Light\SalaCv\.env`, pas dans `smlab\.env`. Sur Vercel, les variables viennent de l'environnement, donc sans effet ; en build local, vérifier qu'elles sont bien prises en compte.
- Connexion Google : autoriser l'URI du relais `/__/auth/` pour chaque domaine dans Google Cloud.
