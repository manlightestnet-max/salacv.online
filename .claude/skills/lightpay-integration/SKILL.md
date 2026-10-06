---
name: lightpay-integration
description: Intégrer le paiement LightPay (wallet LightPay, MTN MoMo, Airtel Money, en FCFA) dans n'importe quelle app web — création de l'app dans la console, connexion du wallet qui encaisse (Connect PKCE), session de paiement côté serveur, dialogue lightpay.js côté client, webhook vérifié et livraison unique. À utiliser dès qu'une app doit vendre quelque chose via LightPay.
---

# Intégrer LightPay

Référence qui marche : SalaCv (`server/shop.js`, `app/buy.js`). Exemple minimal complet, Node sans framework : `examples/server.mjs` + `examples/client.js` + `examples/index.html` (`node examples/server.mjs`).

Deux adresses :
- **API** (serveur → LightPay, clé secrète) : `https://api.smlab.xyz/v1/…`
- **Pages de paiement** (navigateur) : `https://checkout.smlab.xyz` → `/lightpay.js`, `/pay/cs_…`, `/connect`

Le flux : commande chez toi → session LightPay (serveur) → le client paie dans le dialogue → tu **relis la session** chez LightPay → tu livres **une fois**.

## 1. Côté LightPay (console → Développeurs)

1. **Nouvelle app** : nom + identifiant (`ma-boutique`, définitif). Les clés `sec_test_…`, `sec_live_…` et le secret webhook `whsec_…` s'affichent **une seule fois** : variables d'environnement du serveur, jamais dans le navigateur ni dans git. Perdues → « Régénérer les clés » (les anciennes cessent aussitôt).
2. **La clé choisit l'environnement** : `sec_test_` = sandbox, `sec_live_` = argent réel. Envoie quand même `X-Environment: sandbox|production` cohérent.
3. **Sites autorisés** (`embed_origins`) : les origines qui peuvent ouvrir le dialogue en iframe (`https://mon-site.com`, sans chemin). Les origines des adresses de retour comptent aussi. Origine non déclarée → `lightpay.js` bascule tout seul en pleine page.
4. **Adresses de retour Connect** (`redirect_uris`, 1 à 10, https, sans `#`, **correspondance exacte**) : ex. `https://mon-site.com/admin/`. Aussi réglable par API : `PUT /v1/apps/redirect-uris {"redirect_uris":[…]}`.
5. **Webhook** : URL https (ex. `https://mon-site.com/api/lightpay`). Bouton « Envoyer un test » (événement `ping`).

## 2. Connecter le wallet qui encaisse (une fois par environnement)

L'argent ne va pas « à l'app » : il va sur un wallet LightPay **connecté** avec le scope `payee`. On garde son `conn_…`.

1. Serveur : `verifier = base64url(32 octets aléatoires)`, `challenge = base64url(sha256(verifier))` (43 caractères), `state` aléatoire. Garde `{verifier, state, redirectUri, env}` côté serveur.
2. Redirige le propriétaire du wallet vers :
   `https://checkout.smlab.xyz/connect?app_id=…&scope=payee&redirect_uri=…&state=…&code_challenge=…&environment=sandbox|production`
3. Il se connecte (Google), coche les conditions, approuve → retour sur `redirect_uri?code=…&state=…`.
4. Vérifie `state`, puis **dans les 5 min** (code à usage unique) :
   `POST /v1/connect/token {code, redirect_uri, code_verifier}` → `{ connection: { id: "conn_…", scopes, status } }`
5. Stocke `conn_…` par environnement (sandbox et production ont chacun le leur).

## 3. Créer la session (serveur uniquement)

```
POST https://api.smlab.xyz/v1/checkout/sessions
Authorization: Bearer sec_test_…
X-Environment: sandbox
Idempotency-Key: <id de ta commande>
Content-Type: application/json
```

| Champ | Rôle |
|---|---|
| `amount` | Montant payé par le client, en FCFA entiers, **en chaîne** (`"1500"`). |
| `fee_amount` | Commission de ton app, prélevée sur `amount` et versée sur le wallet de l'app (onglet « Solde »). `"0"` si l'app vend pour elle-même. Doit être ≥ 0 et < amount. |
| `payee` | `conn_…` du wallet qui reçoit (scope `payee`, actif). Obligatoire. |
| `escrow` | `true` (défaut !) : argent bloqué jusqu'à `POST /v1/holds/:hold_id/capture` (ou `/release` = remboursement). `false` : versé directement. Vente numérique livrée tout de suite → `false`. |
| `reference` | Ton id de commande. Revient dans la session et le webhook : c'est lui qui relie le paiement à la commande. |
| `description` | Texte montré au client. |
| `return_url` / `cancel_url` | https (ou localhost). Retour après paiement / annulation en mode pleine page. |
| `methods` | `["mobile_money","lightpay_wallet"]` par défaut. |
| `expires_in_minutes` | 30 par défaut, entre 5 et 1440. |
| `metadata` | Objet libre renvoyé tel quel. |

Réponse : `{ duplicate, session: { id: "cs_test_…", status, amount, reference, checkout_url, … } }`. Même `Idempotency-Key` → même session (`duplicate: true`) : un double clic ne crée jamais deux paiements.

Statuts : `OPEN` → `PROCESSING` (mobile money en cours) → `COMPLETED`, ou `EXPIRED` / `CANCELLED` (`POST /v1/checkout/sessions/:id/cancel`). Un échec mobile money remet la session en `OPEN` (le client peut réessayer).

## 4. Côté client

```js
const s = Object.assign(document.createElement('script'), { src: 'https://checkout.smlab.xyz/lightpay.js' });
// … une fois chargé :
const r = await LightPay.pay(checkoutUrl, { theme: 'dark' }); // { status: 'completed' | 'closed', session }
```

- `theme: 'dark' | 'light'` : le dialogue suit le thème de l'app.
- `idToken` : jeton Firebase LightPay du client s'il est déjà connecté à LightPay (pas de deuxième connexion). Sinon, ne rien passer.
- Le dialogue reste sur l'origine LightPay : l'app ne lit rien dedans. Site non déclaré ou iframe bloquée → `lightpay.js` fait lui-même `location.assign(checkoutUrl)`.
- Si **le script** ne se charge pas, fais pareil : `location.href = checkoutUrl`. Le retour arrive sur `return_url`.
- `completed` n'est **qu'un indice d'interface**. Après le dialogue (ou au retour sur `return_url`), demande à **ton serveur** l'état de la commande, quelques fois (le mobile money peut valider après la fermeture).
- Verrouille le bouton pendant l'achat (anti double appui).

## 5. Webhook et vérification

Événements : `checkout.completed`, `checkout.payment_failed`, `deposit.completed`, `refund.sent`, `refund.failed`, `ping`.
Corps : `{ id: "evt_…", type, environment, created, data: { session_id, reference, amount, fee_amount, escrow, hold_id, … } }`.
En-têtes : `LightPay-Event`, `LightPay-Signature: t=<secondes>,v1=<hex HMAC-SHA256(whsec, "t.<corps brut>")>`.

Règles :
1. **Ne jamais croire le contenu.** Le webhook dit seulement *quelle* commande relire (`data.reference`). Vérifie la signature si tu veux (corps brut, comparaison à temps constant, `t` récent), mais dans tous les cas :
2. **Relis la session** : `GET /v1/checkout/sessions/:session_id` avec ta clé secrète (l'id vient de **ta** commande, pas du webhook).
3. Livre seulement si `status === 'COMPLETED'` **et** `reference === id de la commande` **et** `amount === montant de la commande`. `EXPIRED`/`CANCELLED` → marque la commande.
4. **Livraison unique** : contrainte d'unicité sur la commande (ex. `order:<id>` dans ton registre), puis passage `PAID` conditionnel (`WHERE status <> 'PAID'`). Webhook + client qui vérifient en même temps ne livrent qu'une fois.
5. Réponds 2xx vite. LightPay injoignable pendant la relecture → réponds 5xx : LightPay retente (immédiat, +2 s, +10 s, +60 s, puis abandon). Ton endpoint « état de la commande » relit aussi la session : c'est le filet si tous les webhooks échouent.

## 6. Erreurs courantes

| Symptôme | Cause |
|---|---|
| `403 Invalid application credentials` | Clé fausse, régénérée ou app désactivée. |
| `INVALID_FEE` | `fee_amount` négatif ou ≥ `amount`. |
| `CONNECTION_NOT_FOUND` / `CONNECTION_REVOKED` / `SCOPE_NOT_GRANTED` | `payee` d'un autre environnement, déconnecté, ou connecté sans `payee`. Reconnecter le wallet. |
| `INVALID_URL` | `return_url`/`cancel_url` en http (hors localhost). |
| `Missing required header: Idempotency-Key` | En-tête oublié sur un POST. |
| `INVALID_REDIRECT_URI` sur `/connect` | Adresse de retour non déclarée **à l'identique** (slash final compris). |
| `INVALID_GRANT` sur `/connect/token` | Code expiré (5 min), déjà utilisé, mauvais `code_verifier` ou `redirect_uri` différent. |
| `BELOW_MOBILE_MONEY_MINIMUM` | Montant sous le minimum mobile money (réglé dans l'admin LightPay). |
| Dialogue qui part en pleine page | Origine absente des sites autorisés. |
| `429` | Plus de 60 requêtes/min (par défaut), ou trop d'échecs de clé. |
| Payé mais rien livré | Webhook non configuré/en échec et le client ne redemande pas l'état : garder la relecture côté serveur. |
| Plafonds | 250 000 FCFA par paiement et 2 000 000 par jour par défaut (réglables par LightPay). |

## 7. Mise en production

- [ ] Tout validé en sandbox : paiement, fermeture du dialogue, expiration, webhook rejoué, double clic.
- [ ] Clé `sec_live_…` dans les variables du serveur ; `X-Environment: production`.
- [ ] Wallet connecté **en production** (Connect avec `environment=production`) → nouveau `conn_…` live enregistré.
- [ ] Sites autorisés, adresses de retour et webhook pointent vers le domaine de prod (https).
- [ ] Chaque commande garde l'environnement où elle a été créée et est toujours relue avec la clé de **cet** environnement.
- [ ] Aucune clé secrète dans le navigateur, les logs ou git (`.env` ignoré).
- [ ] Un vrai petit paiement MoMo et un Airtel, livrés une seule fois.
