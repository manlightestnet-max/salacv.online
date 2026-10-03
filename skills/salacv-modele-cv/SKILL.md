---
name: salacv-modele-cv
description: Crée un modèle de CV salacv au format DSL (JSON) à partir d'une image, d'un PDF ou d'une description de CV. À utiliser quand on demande « fais un modèle salacv », « transforme ce CV en modèle », « template salacv », ou qu'on fournit un CV à reproduire pour l'admin salacv.
---

# Modèle de CV salacv (DSL JSON)

Tu produis **un seul objet JSON** qui décrit la mise en page d'un CV. salacv le dessine
lui-même (aperçu, PDF, Word) avec le contenu de l'utilisateur. Tu ne recopies **jamais**
le contenu du CV d'exemple (nom, téléphone, expériences) : seulement son **style**.

L'admin colle ton JSON dans **Admin › Modèles › Téléverser un modèle**, voit l'aperçu en
direct, puis enregistre.

## Étapes

1. Observe le CV fourni : en-tête, titres de section, puces, papier, couleurs.
2. Choisis pour chaque champ la valeur la plus proche dans les listes ci-dessous
   (le DSL n'accepte que ces valeurs).
3. Relève les couleurs dominantes en `#RRGGBB` : texte, accent, fond des bandeaux.
4. Réponds avec **uniquement** le JSON, dans un bloc ```json, sans commentaire dedans.
   Si plusieurs lectures sont possibles, propose 2 ou 3 variantes (ids différents).

## Format

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

| Champ | Valeurs autorisées |
|---|---|
| `id` | minuscules, chiffres, tirets, 2 à 40 caractères. Interdits (modèles intégrés) : minimal, bandeau, vitae, diagonale, epure, marine, contraste, classique, cursus, encadre, sobre, cahier |
| `name` | nom court affiché, 40 caractères max |
| `header` | `left`, `center`, `banner`, `pill`, `title` |
| `heading` | `bar`, `band`, `box`, `underline`, `dot` |
| `bullet` | `check`, `dot`, `arrow`, `dash` |
| `paper` | `plain`, `lined` |
| `colors.ink` / `colors.accent` / `colors.band` | `#RRGGBB` |
| `sizes.name` | 12 à 30 |
| `sizes.body` | 7.5 à 12 |
| `sizes.heading` | 8 à 16 |

Aucun autre champ n'est accepté : un champ inventé fait refuser tout le modèle.

## Reconnaître le style

**`header`** (haut du CV)
- Nom en gras à gauche, coordonnées dessous, photo à droite → `left`
- Coordonnées en petit centrées puis grand nom centré, pas de photo → `center`
- « CURRICULUM VITAE » dans un cadre/parchemin, puis « ÉTAT CIVIL » et un tableau
  « Nom : … / Prénom : … » avec photo → `banner`
- « CURRICULUM VITAE » blanc sur fond noir arrondi → `pill`
- « CURRICULUM VITAE » coloré et souligné (souvent style cahier d'école) → `title`

**`heading`** (titres des sections)
- Bandeau gris pleine largeur avec un symbole (❖ ◆) à gauche → `bar`
- Bandeau coloré pleine largeur, titre centré → `band`
- Titre centré dans un cadre arrondi → `box`
- Titre souligné d'un trait → `underline`
- Titre coloré avec une pastille et un soulignement → `dot`

**`bullet`** : ✓ → `check` · • → `dot` · ➢ ▶ → `arrow` · – → `dash`

**`paper`** : feuille lignée de cahier avec marge rouge → `lined`, sinon `plain`.

**`colors`** : `ink` = couleur du texte courant ; `accent` = couleur du grand titre
(`title`) ou des titres `dot` ; `band` = fond des bandeaux (`bar`, `band`). Préfère des
teintes douces pour `band` (le texte noir doit rester lisible dessus).

## Exemples (les modèles intégrés)

```json
{ "id": "classique", "name": "Classique", "header": "left", "heading": "bar", "bullet": "check", "colors": { "band": "#D9D9D9" } }
{ "id": "cursus", "name": "Cursus", "header": "banner", "heading": "band", "bullet": "check", "colors": { "band": "#E7E2CF" } }
{ "id": "encadre", "name": "Encadré", "header": "pill", "heading": "box", "bullet": "dot" }
{ "id": "sobre", "name": "Sobre", "header": "center", "heading": "underline", "bullet": "arrow" }
{ "id": "cahier", "name": "Cahier", "header": "title", "heading": "dot", "bullet": "dash", "paper": "lined", "colors": { "ink": "#1E3A8A", "accent": "#C81E1E" } }
```

## À ne pas faire

- Recopier le contenu du CV d'exemple (noms, numéros, entreprises).
- Ajouter des champs (`font`, `layout`, `columns`…) : ils n'existent pas.
- Mettre des commentaires dans le JSON ou du texte autour quand on demande le JSON seul.
