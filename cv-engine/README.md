# salacv-engine

Moteur de CV : **DSL (JSON) → template → layout → display list → Skia (écran) / PDF vectoriel**.

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
npm test                                   # tests du DSL, du layout et du PDF
npm run render examples/etudiant.json out  # PDF + PNG Skia dans out/
npm run render examples/etudiant.json out -- --watermark
npm run dev                                # démo : éditeur JSON + aperçu live + export PDF (Ctrl+S)
npm run build                              # démo statique dans dist/
```

## DSL

Voir `src/dsl/schema.js` et `examples/etudiant.json`. Un CV = `profile` + une
liste de `sections` typées :

| type       | usage                               | champs                                             |
|------------|-------------------------------------|----------------------------------------------------|
| `timeline` | expériences, formation, projets     | `items[]` : title, org, location, period, bullets  |
| `tags`     | compétences, outils                 | `groups[]` : label, items                          |
| `list`     | langues                             | `items[]` : name, level                            |
| `text`     | centres d'intérêt, paragraphe libre | `body`                                             |

Le titre de section est libre, seul le `type` décide de la mise en forme.

## Ajouter un template

Créer `src/templates/<nom>.js` qui exporte `{ id, margin, build(resume, kit, page) }`
(`build` retourne une liste de blocs), puis l'enregistrer dans
`src/templates/index.js` et dans l'enum `template` du schéma.

## Polices

Sora et DM Mono (SIL Open Font License, voir `fonts/OFL-*.txt`).
