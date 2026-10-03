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

- `POST /api/login` `{ username, password }` : connexion fictive (pas de base de
  données), renvoie un jeton signé côté serveur, valable 7 jours.
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

## Déploiement

Vercel déploie la branche `main` (voir `vercel.json` : build Vite, sortie `dist/`).

L'ancienne landing smlab (Express) est conservée sur la branche `landing`.
