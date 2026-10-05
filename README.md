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

Routes (`server/agent/web.js`), identiques sur Vercel (`api/*.js`) et sur le VPS
(`server/index.js`, site + API dans le même process Node) :

- `POST /api/google` `{ idToken }` : connexion Google (voir « Connexion » plus bas), renvoie un
  jeton de session signé côté serveur, valable 7 jours.
- `POST /api/key` `{ key, device }` : activation d'une clé KEYGEN **en ligne** (PC), session plafonnée à la fin de vie de la clé.
- `POST /api/login` : ancienne connexion fictive, **fermée** (410). `SALACV_ALLOW_PASSWORD_LOGIN=1` ne sert qu'aux essais locaux.
- `POST /api/agent` `{ state, message, history? }` avec `Authorization: Bearer <jeton>`.

Variables d'environnement (Vercel → Settings → Environment Variables, ou `.env` du VPS) :

| Variable | Rôle |
|---|---|
| `OLLAMA_API_KEY` | **La seule obligatoire.** Clé du modèle (`gemma4:31b-cloud`). Plusieurs clés : `OLLAMA_API_KEYS=a,b`. Secours : `GEMINI_API_KEY`, `GROQ_API_KEY`. |
| `OLLAMA_MODEL`, `OLLAMA_BASE_URL` | Changer de modèle ou d'URL sans toucher au code. |
| `SALACV_DEMO_PASSWORD` | Facultatif : seul ce mot de passe ouvre une session (réserver l'assistant aux testeurs). |
| `SALACV_SESSION_SECRET` | Facultatif : clé de signature des sessions (sinon dérivée de la clé du modèle). |
| `AGENT_RATE_PER_MINUTE`, `AGENT_CONCURRENCY`, `AGENT_TIMEOUT`, `AGENT_MAX_ITERATIONS` | Limites (6/min par utilisateur, 8 requêtes simultanées, 25 s par appel au modèle, 8 tours). |

Aucune clé dans le repo, ni en clair ni encodée.

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
`salacv.online` (et `localhost` en développement).

| Variable | Où | Rôle |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | `.env` à la racine, **au build** | Clé web du projet Firebase (publique). Sans elle, la page affiche « non configurée ». |
| `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` | idem | Facultatives (défaut : `lightpay-a5f01.firebaseapp.com`, `lightpay-a5f01`). |
| `FIREBASE_PROJECT_ID` | serveur | Facultative : projet attendu dans les jetons (défaut `lightpay-a5f01`). |
| `SALACV_SESSION_SECRET` | serveur | Clé de signature des sessions (à définir en production). |
| `SALACV_AUTH_ORIGIN` | app Electron | Page de connexion (défaut `https://salacv.online`) ; `http://localhost:5173` en développement. |

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
