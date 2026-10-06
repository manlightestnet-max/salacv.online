#!/usr/bin/env node
// Secours si l'admin du site est inaccessible : rend SALACV_MASTER_KEY (et SALACV_SESSION_SECRET) à partir de
// la phrase de récupération enregistrée dans l'admin (Clés IA → Phrase de récupération).
//
//   DATABASE_URL=postgresql://… node scripts/recover-master.mjs
//   (ou DATABASE_URL dans .env : il est lu s'il existe)
//
// La phrase est demandée sans être affichée. Rien n'est écrit sur le disque.
import fs from 'node:fs';
import readline from 'node:readline';

if (!process.env.DATABASE_URL && fs.existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL manquante (la base Neon de production).');
  process.exit(1);
}

const { recoverMaster } = await import('../server/recovery.js');

// Saisie masquée : rien ne s'affiche pendant la frappe.
function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

try {
  const keys = await recoverMaster(await ask('Phrase de récupération : '));
  console.log(`\nSauvegarde du ${new Date(keys.at).toLocaleString('fr-FR')}`);
  console.log(`SALACV_MASTER_KEY=${keys.masterKey}`);
  if (keys.sessionSecret) console.log(`SALACV_SESSION_SECRET=${keys.sessionSecret}`);
  console.log('\nRemets ces valeurs dans Vercel (Settings → Environment Variables), puis redéploie.');
  process.exit(0);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
