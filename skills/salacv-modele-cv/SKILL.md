---
name: salacv-modele-cv
description: Transforme n'importe quelle image de CV en modèle salacv (JSON « canvas » : rectangles, lignes, cercles, textes, photo, zones de contenu, avec les variables salacv). À utiliser quand on donne une image, une capture ou un PDF de CV en demandant « fais-en un modèle salacv », « template salacv », « reproduis ce style ».
---

# Modèle de CV salacv à partir d'une image

Tu regardes une image de CV et tu produis **un seul objet JSON** qui en reproduit la mise
en page : formes (rectangles, lignes, cercles, polygones), textes, photo, et les **zones**
où salacv fera couler le contenu de l'utilisateur. salacv relie lui-même les variables
(`{{name}}`, `{{title}}`…) au contenu, et dessine l'aperçu, le PDF et le Word.

Tu ne recopies **jamais** le contenu de l'image (nom, téléphone, expériences, écoles) :
tu le remplaces par les variables. Seul le **style** est reproduit.

L'admin colle ton JSON dans **Admin › Modèles › Téléverser un modèle** : l'aperçu
s'affiche aussitôt, puis il enregistre.

## Méthode

1. **Repère la page** : A4 = **595 × 842 points**, origine en haut à gauche, `y` vers le bas.
   Convertis les positions de l'image : `x = x_px × 595 / largeur_px`, `y = y_px × 842 / hauteur_px`.
2. **Palette** : relève 3 à 6 couleurs en `#RRGGBB` et nomme-les dans `colors`
   (`ink` = texte, `accent` = titres, `muted` = texte secondaire, plus ce qu'il faut :
   `band`, `side`…). Utilise-les ensuite avec `$nom`.
3. **Décor** (`decor`) : les formes de fond — bandeaux, colonne latérale colorée, filets,
   motifs. `"page": "all"` pour les répéter sur chaque page (une colonne de fond par ex.).
4. **En-tête** (`header`, première page) : la photo, le nom, le titre, les coordonnées,
   les textes fixes (« CURRICULUM VITAE »), avec les variables.
5. **Zones** (`areas`) : la première est la zone principale (elle passe à la page suivante
   si besoin) ; les autres sont des colonnes de la première page. Donne `x`, `y` (où le
   contenu commence), `w` et `content`.
6. **Sections** (`section`) : le style des titres de section, des puces, des périodes et
   du texte, tel qu'on le voit sur l'image.
7. Réponds avec **uniquement** le JSON dans un bloc ```json, sans commentaire dedans.

## Variables (dans `text`)

| Variable | Contenu |
|---|---|
| `{{name}}` | nom complet |
| `{{title}}` | profession / titre |
| `{{email}}`, `{{phone}}`, `{{phones}}`, `{{address}}`, `{{link}}` | coordonnées |
| `{{summary}}` | profil professionnel |
| `{{label:curriculum}}` | « Curriculum Vitae » traduit dans la langue du CV |
| `{{label:contact}}`, `{{label:profile}}`, `{{label:identity}}`, `{{label:name}}`, `{{label:profession}}` | autres libellés traduits |

Préfère toujours un libellé (`{{label:…}}`) à un texte écrit en dur : le CV se traduit.

## Primitives

Toutes acceptent `"page": "first"` (par défaut) ou `"all"` (dans `decor`).

| `type` | Champs |
|---|---|
| `rect` | `x, y, w, h`, `r` (coins), `fill`, `stroke`, `lw` |
| `line` | `x1, y1, x2, y2`, `color`, `lw` |
| `circle` | `cx, cy, r`, `fill` |
| `poly` | `points: [[x,y],…]` (3 à 40), `fill` — diagonales, vagues, flèches |
| `text` | `x, y` (haut du texte), `w` (largeur, retour à la ligne), `text`, `size`, `weight` (400/500/600/700), `font` (`sans`/`mono`), `color`, `align` (`left`/`center`/`right`), `upper`, `tracking`, `lineHeight` |
| `photo` | `x, y, w, h`, `shape` (`rect`/`circle`), `r`, `bg`, `hideEmpty` |
| `contacts` | `x, y, w` : toutes les coordonnées l'une sous l'autre ; `labels` (`true` = « Email : … », `"above"` = libellé au-dessus), `labelColor`, `gap`, + styles de texte |

Couleurs : `#RRGGBB` ou `$nom` (défini dans `colors`).

## Zones (`areas`)

```json
{ "x": 210, "y": 132, "w": 350, "content": ["summary", "timeline", "text"] }
```

`content` choisit ce qui va dans la zone :
`summary` (profil), `timeline` (formation, expérience), `text`, `bullets` (compétences,
loisirs), `list` (langues), `rest` (tout ce qui n'est pas pris ailleurs).
Par défaut : la première zone prend `rest`, les autres `bullets` + `list`.

## Style des sections (`section`)

| Champ | Valeurs |
|---|---|
| `size`, `color`, `muted`, `font`, `spacing` | texte courant |
| `bullet` | `dot`, `check`, `arrow`, `dash`, `square`, `none` ; `bulletColor` |
| `period` | `{ "position": "inline" \| "above", "color", "weight" }` — « 2023 — 2026 : » sur la ligne ou au-dessus |
| `heading` | `size`, `weight`, `color`, `upper`, `align` (`left`/`center`), `height`, `gap`, `band` (couleur de bandeau), `box` (couleur de cadre), `radius`, `underline` (`true` = sous le texte, `"full"` = toute la largeur), `underlineColor`, `underlineWidth`, `marker` (`diamond`/`dot`/`bar`), `markerColor` |

## Exemple complet (CV à bandeau bleu et colonne grise)

```json
{
  "kind": "canvas",
  "id": "bandeau-bleu",
  "name": "Bandeau bleu",
  "colors": { "ink": "#1F2937", "accent": "#1E3A8A", "band": "#8EA2D6", "side": "#F3F4F6", "muted": "#6B7280" },
  "page": { "top": 40, "bottom": 46 },
  "decor": [
    { "type": "rect", "x": 0, "y": 0, "w": 595.28, "h": 112, "fill": "$band" },
    { "type": "rect", "x": 0, "y": 112, "w": 190, "h": 730, "fill": "$side", "page": "all" },
    { "type": "line", "x1": 190, "y1": 112, "x2": 190, "y2": 842, "color": "#D1D5DB", "lw": 0.8, "page": "all" }
  ],
  "header": [
    { "type": "photo", "x": 40, "y": 30, "w": 110, "h": 110, "shape": "circle", "bg": "#E5E7EB" },
    { "type": "text", "x": 210, "y": 34, "w": 360, "text": "{{name}}", "size": 22, "weight": 600, "color": "#FFFFFF", "upper": true },
    { "type": "text", "x": 210, "y": 66, "w": 360, "text": "{{title}}", "size": 11, "weight": 600, "color": "$accent", "upper": true },
    { "type": "text", "x": 22, "y": 160, "w": 150, "text": "{{label:contact}}", "size": 11, "weight": 500, "color": "$accent", "upper": true },
    { "type": "contacts", "x": 22, "y": 180, "w": 150, "size": 8.4, "color": "$ink", "gap": 1 }
  ],
  "areas": [
    { "x": 210, "y": 132, "w": 350, "content": ["summary", "timeline", "text"] },
    { "x": 22, "y": 260, "w": 150, "content": ["bullets", "list"] }
  ],
  "section": {
    "size": 8.8,
    "color": "$ink",
    "bullet": "dot",
    "period": { "position": "above", "color": "$muted" },
    "heading": { "size": 10.5, "weight": 500, "color": "$accent", "underline": "full", "underlineColor": "#CBD5E1", "height": 18 }
  }
}
```

## Règles

- `kind` vaut toujours `"canvas"`. `id` : minuscules, chiffres, tirets (2 à 40), pas un
  modèle intégré (minimal, bandeau, vitae, diagonale, epure, marine, contraste, classique,
  cursus, encadre, sobre, cahier). `name` : 40 caractères max.
- Aucun autre champ que ceux listés : un champ inventé fait refuser le modèle (le message
  dit lequel).
- Laisse des marges (≥ 20 points) et assez de place aux zones : le contenu réel peut être
  plus long que celui de l'image.
- Polices disponibles : `sans` (Geist) et `mono` (Geist Mono). Pas d'autre police.
