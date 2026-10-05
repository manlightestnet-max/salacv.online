# salacv

Éditeur de CV pour étudiants. Moteur : **DSL (JSON) → template → layout → display list → Skia (écran) / PDF vectoriel**.

```
DSL JSON ──parseResume──► resume validé
          ──template────► blocs (ops en coordonnées locales)
          ──paginate────► display list par page (text, rect, line, circle)
                              ├─► render/skia.js  aperçu éditeur (CanvasKit)
                              └─► render/pdf.js   PDF vectoriel (pdf-lib)
```

Tout le placement est calculé une seule fois dans le layout ; les deux renderers
ne font que rejouer la display list. Les largeurs viennent des avances brutes des
polices (sans ligatures ni kerning), ce que Skia et pdf-lib dessinent tous les
deux : l'écran et le PDF coupent les lignes aux mêmes endroits. Le PDF contient
du vrai texte (sélectionnable, lisible par les logiciels de tri de CV).

## Commandes

```bash
npm install
npm test                                   # tests du DSL, du layout, du PDF, du formulaire et de l'agent
npm run render examples/etudiant.json out  # PDF + PNG Skia dans out/
npm run render examples/etudiant.json out -- --watermark
npm run dev                                # éditeur (app/) ; /api est relayé vers npm start (port 3000)
npm run build                              # site statique dans dist/ (déployé par Vercel)
```

## Éditeur (app/)

Mobile : le CV en aperçu plein écran, le formulaire dans un bottom sheet
(replié : étape en cours + étapes ; déplié : formulaire ; bouton « Aperçu » ou
glisser vers le bas pour revenir au CV). PC (≥ 960 px) : formulaire dans une
barre de gauche redimensionnable (largeur mémorisée, double-clic pour la remettre
par défaut). Aperçu zoomable partout : boutons, Ctrl + molette, pincement.
Tant qu'une partie n'est pas remplie, l'aperçu montre celle de l'exemple en
grisé (`ghost` dans le DSL) ; le PDF ne contient que les saisies. Sept étapes dans l'ordre du CV congolais :
Identité, Profil, Formation, Expérience, Compétences, Langues & loisirs, Vérification.
Formations, expériences et langues sont des blocs repliables (un seul ouvert,
les autres résumés en une ligne) ; téléphones, compétences et loisirs se
saisissent un par un (Entrée pour ajouter, ✕ pour supprimer). Les ajouts et
suppressions ne reconstruisent jamais l'étape (`app/components.js`).
Formations et expériences sont triées du plus récent au plus ancien.
Aucun détail technique n'est montré : `app/state.js` convertit le formulaire en DSL.

Raccourcis (clavier) : `Alt ←/→` étapes, `Ctrl+Entrée` ajouter un élément,
`Ctrl+S` vérification et téléchargement, `Ctrl +/−/0` zoom, `Échap` revenir à l'aperçu.

## DSL

Voir `src/dsl/schema.js` et `examples/etudiant.json`. Un CV = `profile` + une
liste de `sections` typées :

| type       | usage                               | champs                                             |
|------------|-------------------------------------|----------------------------------------------------|
| `timeline` | formation, expérience               | `items[]` : period, title, org, location, bullets  |
| `bullets`  | compétences, loisirs                | `items[]` : texte                                  |
| `list`     | langues                             | `items[]` : name, level                            |
| `text`     | centres d'intérêt, paragraphe libre | `body`                                             |

Le titre de section est libre, seul le `type` décide de la mise en forme.

## Ajouter un template

Créer `src/templates/<nom>.js` qui exporte `{ id, margin, build(resume, kit, page) }`
(`build` retourne une liste de blocs), puis l'enregistrer dans
`src/templates/index.js` et dans l'enum `template` du schéma.

## Polices

Geist et Geist Mono (SIL Open Font License, voir `fonts/OFL-*.txt`). Thème : tokens Salacope (`app/tokens.css`).

## Assistant (agent)

`server/agent/` : l'étudiant écrit ses infos en vrac ou une modification (« ajoute
Excel »), l'agent remplit le CV avec des outils puis répond en une phrase. Même
architecture que l'agent Ivy : un outil = un fichier (`tools/`), boucle jusqu'à
`final_answer`, rotation des clés et bascule de fournisseur sur 429, skills.
Aucun outil shell, fichier ou réseau : l'agent ne peut que modifier le CV reçu.

Routes (`server/http.js`), identiques sur Vercel (`api/*.js`) et sur le VPS
(`server/index.js`, site + API dans le même process Node) :

- `POST /api/google` `{ idToken }` : connexion Google (voir « Connexion » plus bas), renvoie un
  session valable 7 jours : le jeton signé est posé dans un **cookie httpOnly** (`sv_session`), jamais renvoyé à la page. Seul le relais de
  l'app desktop (en-tête `X-Salacv-Client: desktop`) le reçoit, pour son coffre chiffré (`safeStorage`). `POST /api/me` dit qui est connecté ; `POST /api/logout` efface les cookies.
- `POST /api/key` `{ key, device }` : activation d'une clé KEYGEN **en ligne** (PC), session plafonnée à la fin de vie de la clé.
- `POST /api/login` : ancienne connexion fictive, **fermée** (410). `SALACV_ALLOW_PASSWORD_LOGIN=1` ne sert qu'aux essais locaux.
- `POST /api/agent` `{ state, message, history? }` avec `Authorization: Bearer <jeton>`.
- `POST /api/config` : valeurs publiques du site (Firebase), sans secret.

**Configuration : presque tout se règle dans l'interface admin** (`/admin/`, onglet « Clés IA ») : clés des
fournisseurs (Ollama, Gemini, Groq), attribution de clés aux clients, configuration Firebase. Rien de tout ça n'est en variable d'environnement.

Seuls ces secrets de **démarrage** restent en variables d'environnement (Vercel → Settings → Environment Variables, ou `.env` du VPS) :

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Connexion **Neon** (Postgres). Sans elle, une base locale PGlite est utilisée (dossier `data/pg`) : développement seulement. |
| `SALACV_MASTER_KEY` | Clé maître (32 octets en base64) qui chiffre les clés d'API enregistrées en base. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **À sauvegarder** : sans elle, les clés enregistrées sont illisibles. |
| `SALACV_SESSION_SECRET` | **Facultative** : sans elle, la clé de signature des sessions est dérivée de `SALACV_MASTER_KEY`. |
| `SALACV_ADMIN_UID` | **UID Firebase** du compte Google de l'administrateur (plusieurs UID séparés par des virgules). L'admin se connecte **uniquement avec Google** : le serveur compare l'UID du compte à cette valeur secrète. Où le trouver : Firebase Console → Authentication → Utilisateurs → colonne « UID ». |
| `AGENT_RATE_PER_MINUTE`, `AGENT_CONCURRENCY`, `AGENT_TIMEOUT`, `AGENT_MAX_ITERATIONS` | Facultatives : limites (6/min par utilisateur, 8 requêtes simultanées, 25 s par appel au modèle, 8 tours). |

Les clés d'environnement (`OLLAMA_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`…) ne servent plus que de **secours**
(développement, ou pool partagé encore vide).

### Clés IA, rotation et accès

salacv fournit l'IA (Ollama Cloud, avec Gemini et Groq en secours) : **les clients n'ont jamais de clé à gérer ni à voir.**
Tout se règle par l'admin, dans l'onglet « Clés IA » :

- **Pool** : l'admin ajoute autant de clés qu'il veut ; elles servent à tous les clients, en rotation.
- **Attribution** : l'admin peut attribuer une ou plusieurs clés à un client précis. **Un client qui a des clés attribuées ne
  consomme que celles-là, jamais le pool.**
- **Rotation** : première clé utilisable (ordre des fournisseurs) ; sur 429 elle est mise de côté pour la journée (en base,
  donc pour toutes les instances) ; sur 401/403 elle est désactivée.
- **Accès à l'IA** : il faut être connecté (Google ou clé en ligne). L'accès est accordé à la connexion ; l'admin peut le
  retirer par utilisateur. Chaque appel est noté (`ai_usage`) pour les **quotas**, pas encore appliqués.
- Les clés sont chiffrées (AES-256-GCM) et **ne sont jamais renvoyées** : l'interface n'affiche que les 4 derniers caractères.

### Visiteurs, crédits, génération et sauvegarde

- **Visiteur non connecté (web)** : il essaie l'éditeur et l'assistant sans compte. L'IA utilise uniquement les clés étiquetées
  « Public » et un quota de **250 000 tokens, une seule fois**, par session ET par IP (réglable dans l'admin). Il est reconnu par
  son IP (IPv6 réduite au /64) et un cookie signé : effacer le navigateur ne remet rien à zéro. Il n'a **aucune sauvegarde** et
  **zéro crédit** ; le tableau de bord lui est fermé.
- **Génération du CV côté serveur** (`/api/render`) : le serveur décide des droits. Visiteur ou compte sans crédit → **PDF avec
  filigrane, Word bloqué**. Compte avec crédit → PDF propre + Word, **1 crédit par version** (re-télécharger la même version est
  gratuit). Débit atomique en base, registre `credit_ledger`, jamais de solde négatif ni de double débit.
- **Cadeau d'inscription** (admin → Clés IA) : crédits offerts à la première connexion ; 3 par défaut, 0 pour le désactiver.
- **Sauvegarde des CV** (`/api/projects`) : **uniquement sur Cloudflare R2**, dans le dossier du compte (`u/<empreinte>/…`, jamais d'e-mail) ;
  la base ne garde que l'index. R2 non configuré = enregistrement refusé avec un message clair (aucun repli). Le navigateur ne garde
  plus rien : ni CV, ni session, ni jeton. Restent seulement des préférences d'affichage (thème, mode Lite/Pro, largeur du panneau).
  Les PDF payés des clients sont aussi gardés sur R2.
- **Avis** (`/api/feedback`) : note + mot de n'importe quel utilisateur, un par personne, 5 nouveaux par IP et par jour ; ils
  alimentent les statistiques de la landing (`/api/stats` : note moyenne, CV préparés — rien n'est affiché sans donnée réelle).
- **Mode Pro** : « Générer » ouvre une fenêtre pour choisir, CV par CV (et par langue), PDF et/ou Word.
- **Vercel** : une seule fonction (`api/[route].js`) sert toutes les routes (la formule gratuite limite le nombre de fonctions).

### App desktop

Client léger : l'interface est servie localement, mais tout `/api/*` part vers le backend en ligne
(`SALACV_AUTH_ORIGIN`). Aucun secret, clé ni base de données ne vit sur le PC.

```bash
npm start      # VPS : site (dist/) + API sur PORT (3000), après npm run build
```

## Connexion : Google et clés KEYGEN

**Google (web et PC)** : Firebase, même projet que LightPay et Salacope (`lightpay-a5f01`). La page
`/auth/` (`app/auth.js`) fait la connexion Google ; le serveur vérifie le jeton avec `jose`
(`server/accounts/firebase.js`) et ouvre une session salacv. salacv ne voit jamais de mot de passe.
Sur PC, l'app Electron ouvre cette page **dans le navigateur du système** (Google refuse les
fenêtres intégrées), puis reçoit le jeton sur son port local (`electron/main.cjs`, `/__desktop/callback`).

À configurer (Firebase Console → Authentication) : activer le fournisseur Google ; domaines autorisés :
`smlab-theta.vercel.app` (et `localhost` en développement ; ajouter `salacv.online` quand le domaine sera acheté).

| Variable | Où | Rôle |
|---|---|---|
| Admin → Clés IA → « Connexion Google (Firebase) » | interface admin | Clé web (`apiKey`), `authDomain`, `projectId`. Lues par le site **à l'exécution** (rien à redéployer). Sans clé, la page affiche « non configurée ». |
| `FIREBASE_PROJECT_ID` | serveur | Facultative : projet attendu dans les jetons (défaut `lightpay-a5f01`). |
| `VITE_FIREBASE_*` | `.env`, au build | Secours si l'admin n'a rien renseigné. |
| `SALACV_AUTH_ORIGIN` | app Electron | Page de connexion et backend (défaut `https://smlab-theta.vercel.app`) ; `http://localhost:5173` en développement. |

**Clés KEYGEN (PC uniquement)** — deux sortes, générées avec `scripts/keygen.js` :

- **Hors ligne** `SCVO-…` : autonome, signée Ed25519, vérifiée sur le PC **sans Internet**
  (`src/license/offline.js`). Elle ne contient ni nom ni date de fin ; la durée de vie démarre à la
  première activation et se garde sur le PC (`src/license/activation.js`, fichier chiffré de `userData`).
  Elle ne peut pas être révoquée avant sa fin ni empêchée d'être saisie sur un autre PC.
- **En ligne** `SCVN-…` : un code opaque, **sans rien dedans**. Le serveur garde l'empreinte, l'appareil
  (une clé = un PC), le début et la fin ; il peut la révoquer. Elle ouvre une session (assistant, crédits).

```bash
node scripts/keygen.js init --out C:\secrets\salacv-keygen.pem   # une fois : clé privée HORS du dépôt + clé publique à coller dans src/license/public-key.js
node scripts/keygen.js offline --count 5                            # (KEYGEN_PRIVATE_KEY_FILE ou --private <fichier>)
node scripts/keygen.js online --count 5 --note "client X"
node scripts/keygen.js revoke SCVN-…   ·   node scripts/keygen.js list
```

**Durée de vie : à fixer à la fin des modifications** dans `src/license/config.js`
(`KEY_LIFETIME_DAYS`). Tant que la valeur est `null`, aucune clé ne s'active (refus explicite, on ne devine pas).

## Déploiement

Vercel déploie la branche `main` (voir `vercel.json` : build Vite, sortie `dist/`).

L'ancienne landing smlab (Express) est conservée sur la branche `landing`.
