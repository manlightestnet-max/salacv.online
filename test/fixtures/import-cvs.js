// CV de test pour l'import (fabriqués pour les tests, aucune personne réelle) : le texte tel que pdf.js le lit,
// et la réponse que l'IA pourrait renvoyer — avec, exprès, des erreurs de lecture à attraper.
export const CVS = [
  {
    name: 'une colonne, tout juste',
    text: `MOUKALA Prisca
Comptable junior
prisca.moukala@gmail.com · +242 06 612 34 56 · Brazzaville, Moungali
FORMATION
2021 – 2024 Licence en comptabilité et finance, Université Marien Ngouabi
EXPÉRIENCE
Mars – Août 2024 Stagiaire comptable, Cabinet Ngoma & Associés
Saisie des pièces comptables et rapprochements bancaires
Préparation des déclarations de TVA
COMPÉTENCES Sage Saari, Excel avancé, Fiscalité congolaise
LANGUES Français (courant), Lingala (natif), Anglais (notions)`,
    ai: {
      profile: { name: 'MOUKALA Prisca', title: 'Comptable junior', email: 'prisca.moukala@gmail.com', phones: ['+242 06 612 34 56'], address: 'Brazzaville, Moungali' },
      education: [{ title: 'Licence en comptabilité et finance', org: 'Université Marien Ngouabi', period: '2021 – 2024' }],
      experiences: [{ title: 'Stagiaire comptable', org: 'Cabinet Ngoma & Associés', period: 'Mars – Août 2024', details: ['Saisie des pièces comptables et rapprochements bancaires', 'Préparation des déclarations de TVA'] }],
      skills: ['Sage Saari', 'Excel avancé', 'Fiscalité congolaise'],
      languages: [{ name: 'Français', level: 'Courant' }, { name: 'Lingala', level: 'Natif' }, { name: 'Anglais', level: 'Notions' }],
    },
    expectVerify: [],
  },
  {
    name: 'deux colonnes, l’IA se trompe sur l’e-mail et invente une entreprise',
    text: `ITOUA Jean-Baptiste   Électricien bâtiment
Contact            Expérience
06 543 21 09       2019 — 2023  Chef d'équipe électricité, Société Bâtir Congo
jb.itoua@yahoo.fr  Installation électrique de 40 logements sociaux
Pointe-Noire       Formation
                   2017  BT Électricité, Lycée technique de Pointe-Noire`,
    ai: {
      profile: { name: 'ITOUA Jean-Baptiste', title: 'Électricien bâtiment', email: 'jb.itoua@yahoo.com', phones: ['06 543 21 09'], address: 'Pointe-Noire' },
      education: [{ title: 'BT Électricité', org: 'Lycée technique de Pointe-Noire', period: '2017' }],
      experiences: [
        { title: "Chef d'équipe électricité", org: 'Société Bâtir Congo', period: '2019 — 2023', details: ['Installation électrique de 40 logements sociaux'] },
        { title: 'Électricien', org: 'Total Congo', period: '2015 — 2017' },
      ],
      uncertain: ['profile.address'],
    },
    // « Électricien » est bien dans le document (titre) : seuls l'entreprise et les dates inventées sont à vérifier.
    expectVerify: ['experiences.1.org', 'experiences.1.period', 'profile.address', 'profile.email'],
  },
  {
    name: 'dates impossibles et doublon',
    text: `NGOUABI Rose
Infirmière
2020 – 2018 Infirmière, CHU de Brazzaville
2020 – 2018 Infirmière, CHU de Brazzaville
2045 Diplôme d'État d'infirmier, École de santé Jean-Joseph Loukabou`,
    ai: {
      profile: { name: 'NGOUABI Rose', title: 'Infirmière' },
      education: [{ title: "Diplôme d'État d'infirmier", org: 'École de santé Jean-Joseph Loukabou', period: '2045' }],
      experiences: [
        { title: 'Infirmière', org: 'CHU de Brazzaville', period: '2020 – 2018' },
        { title: 'Infirmière', org: 'CHU de Brazzaville', period: '2020 – 2018' },
      ],
    },
    expectVerify: ['education.0.period', 'experiences.0.period', 'experiences.1', 'experiences.1.period'],
  },
];
