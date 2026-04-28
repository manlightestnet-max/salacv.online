# smlab — Landing Page

Node.js + Express + Docker. Déploiement via Coolify.

## Structure

```
smlab/
├── server.js
├── package.json
├── Dockerfile
├── docker-compose.yml
└── public/
    ├── index.html
    ├── css/style.css
    └── js/main.js
```

## Dev local

```bash
npm install
npm run dev        # nodemon, hot reload
# ou
docker compose up  # http://localhost:3000
```

## Deploy sur Coolify

1. Push le projet sur GitHub/Gitea
2. Dans Coolify → New Resource → Git Repository
3. Build Pack : **Dockerfile**
4. Port : **80**
5. Domain : `smlab.xyz` ou sous-domaine voulu
6. Deploy

## Variables d'environnement

Aucune requise. Optionnel :
- `PORT` — port d'écoute (défaut : 80)
- `NODE_ENV` — `production` ou `development`

## Health check

```
GET /health → { "status": "ok", "service": "smlab-landing" }
```
