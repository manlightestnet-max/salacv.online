# Agent salacv

L'étudiant écrit ses informations en vrac ou une demande de modification
(« reformule mon stage chez Vodacom », « ajoute Excel ») ; l'agent remplit ou
modifie son CV avec des outils, puis répond en une phrase. Une requête HTTP = une
exécution de l'agent.

Architecture reprise de l'agent Ivy : un outil = un fichier (`tools/`), boucle
modèle ↔ outils jusqu'à `final_answer` (`loop.py`), rotation des clés et bascule
de fournisseur sur 429 (`llm/`), secrets masqués (`secrets.py`), skills chargées
à la demande (`skills/`). Pas d'outil shell, fichier ou réseau : l'agent ne peut
que modifier le CV qu'on lui envoie.

```
navigateur ──► backend du site (vérifie la connexion) ──► agent (VPS) ──► fournisseur LLM
              Authorization: Bearer AGENT_ACCESS_TOKEN, X-User-Id
```

## API

`POST /v1/agent`

```json
{ "state": { …CV du formulaire (app/state.js)… }, "message": "…", "history": [{ "role": "user", "text": "…" }] }
```

Réponse : `{ "ok": true, "reply": "…", "state": { …CV modifié… }, "changes": ["identité", …] }`.
Erreurs : 400 message vide, 401 jeton, 413 > 64 Ko, 429 débit, 503 occupé ou fournisseur indisponible, 504 délai.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `OLLAMA_API_KEY` ou `OLLAMA_API_KEYS` | Clé(s) du fournisseur par défaut (`gemma4:31b-cloud`). Même règle `<NOM>_API_KEY(S)` pour les autres fournisseurs de `providers.json`. |
| `AGENT_ACCESS_TOKEN` | Jeton partagé avec le backend du site. Sans lui, le serveur refuse tout (sauf `AGENT_DEV=1`). |
| `AGENT_WORKERS` | Nombre de process (défaut 4). |
| `AGENT_QUEUE_LIMIT` | Requêtes en attente au-delà des process avant 503 (défaut 16). |
| `AGENT_RATE_PER_MINUTE` | Requêtes par utilisateur et par minute (défaut 6). |
| `AGENT_TIMEOUT`, `AGENT_MAX_ITERATIONS` | Délai d'appel au modèle (90 s), tours de boucle (8). |
| `AGENT_HOST`, `AGENT_PORT` | Écoute (défaut `127.0.0.1:8787`, derrière Caddy). |
| `AGENT_ALLOWED_ORIGINS` | Origines CORS autorisées, séparées par des virgules. |

**Aucune clé dans le repo**, ni en clair ni encodée (le base64 se décode en une
seconde). Sur le VPS : un fichier `.env` lisible seulement par l'utilisateur du
service (`chmod 600`), chargé par systemd ou Docker.

## Lancer

```bash
python3 -m agent.server                              # Python 3.10+, aucune dépendance
python3 -m unittest discover -s agent/tests -t .     # tests avec modèle simulé, sans réseau
```
