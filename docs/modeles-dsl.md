# DSL des modèles de CV

Deux formes, dans le même champ « Téléverser un modèle » :

- **canvas** (`"kind": "canvas"`) : n'importe quelle mise en page, décrite par des
  primitives (rect, line, circle, poly, text, photo, contacts) posées sur la page A4
  (595 × 842 points), des zones où le contenu s'écoule et les variables salacv
  (`{{name}}`, `{{title}}`, `{{label:curriculum}}`…). C'est ce qu'un agent produit à partir
  d'une image : la référence complète est le skill
  [`skills/salacv-modele-cv/SKILL.md`](../skills/salacv-modele-cv/SKILL.md), avec un
  exemple dans [`docs/exemples/canvas-bandeau.json`](exemples/canvas-bandeau.json).
- **préréglé** (ci-dessous) : une colonne, quelques choix (en-tête, titres, puces).

## Forme préréglée

Un modèle de CV salacv peut être décrit en **JSON**, sans écrire de code. N'importe qui
peut écrire ce fichier ; l'admin le téléverse dans **Admin › Modèles › Téléverser un
modèle**. L'aperçu se met à jour pendant la saisie. Une fois enregistré, le modèle
apparaît dans le studio (liste des modèles, carte de l'espace Pro) et se règle comme les
autres : disponible ou non, pour Tous / Lite / Pro.

Le même moteur dessine l'aperçu, le PDF et le Word. Les cinq modèles « Classique »,
« Cursus », « Encadré », « Sobre » et « Cahier » sont eux-mêmes écrits dans ce DSL
(`src/templates/congo.js`).

## Exemple

```json
{
  "id": "kin-bleu",
  "name": "Kin bleu",
  "header": "banner",
  "heading": "band",
  "bullet": "check",
  "paper": "plain",
  "colors": { "ink": "#111111", "accent": "#1D4ED8", "band": "#DBEAFE" },
  "sizes": { "name": 18, "body": 9.4, "heading": 10.5 }
}
```

## Champs

| Champ | Obligatoire | Valeurs | Par défaut |
|---|---|---|---|
| `id` | oui | minuscules, chiffres, tirets (2 à 40). Pas l'id d'un modèle intégré. | — |
| `name` | oui | nom affiché (40 caractères max) | — |
| `header` | non | `left`, `center`, `banner`, `pill`, `title` | `left` |
| `heading` | non | `bar`, `band`, `box`, `underline`, `dot` | `underline` |
| `bullet` | non | `check`, `dot`, `arrow`, `dash` | `dot` |
| `paper` | non | `plain`, `lined` | `plain` |
| `colors.ink` | non | texte, `#RRGGBB` | `#111111` |
| `colors.accent` | non | accent (en-tête `title`, titres `dot`), `#RRGGBB` | `#111111` |
| `colors.band` | non | fond des bandeaux (`bar`, `band`), `#RRGGBB` | `#D9D9D9` |
| `sizes.name` | non | taille du nom, 12 à 30 | 17 |
| `sizes.body` | non | taille du texte, 7.5 à 12 | 9.4 |
| `sizes.heading` | non | taille des titres de section, 8 à 16 | 10.5 |

### `header` — l'en-tête

- `left` : nom en gras et coordonnées à gauche, photo à droite.
- `center` : coordonnées en petites capitales puis nom en grand, tout centré, sans photo.
- `banner` : « CURRICULUM VITAE » dans un cadre, bandeau « État civil », tableau
  « Nom : … / Profession : … », photo à droite.
- `pill` : « CURRICULUM VITAE » blanc sur pastille noire, coordonnées à gauche, photo à droite.
- `title` : « CURRICULUM VITAE » en couleur d'accent, souligné, puis tableau d'état civil.

### `heading` — les titres de section

- `bar` : bandeau pleine largeur (couleur `band`) avec un losange ◆.
- `band` : bandeau pleine largeur, titre centré.
- `box` : cadre arrondi, titre centré.
- `underline` : titre souligné sur toute la largeur.
- `dot` : pastille et soulignement en couleur d'accent.

### `paper`

- `lined` : feuille de cahier (lignes bleues, marge rouge) sur chaque page.

## Règles

- Tout champ inconnu est refusé (le message dit lequel) : pas de code, pas de surprise.
- Les textes (« CURRICULUM VITAE », « État civil », titres de section…) se traduisent
  avec le CV (français, anglais, lingala, swahili, portugais).
- Un CV qui utilise un modèle supprimé repasse sur « Minimal », sans erreur.
