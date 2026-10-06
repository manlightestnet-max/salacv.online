// Barre de progression de l'IA gratuite du visiteur (web, non connecté) : en haut de l'application, avec le
// message qui invite à se connecter. Le quota est compté par le serveur (session + IP) ; ici on ne fait que l'afficher.
// Se met à jour avec chaque réponse de l'IA (événement « salacv:quota »).
import { h } from './dom.js';
import { readSession } from './login.js';

const desktop = () => Boolean(window.desktop?.isDesktop);

export function initQuotaBar() {
  if (desktop() || readSession()) return; // connecté (ou app desktop, qui exige la connexion) : pas de barre
  const fill = h('span', { class: 'quota-fill' });
  const pct = h('strong', { class: 'quota-pct' }, '…');
  const msg = h('p', { class: 'quota-msg' }, 'Connecte-toi pour garder ton CV');
  const login = h('a', { class: 'quota-login', href: `/auth/?next=${encodeURIComponent(location.pathname + location.search)}` }, 'Se connecter');
  const bar = h('div', { class: 'quota-bar', role: 'status', hidden: true }, h('div', { class: 'quota-text' }, msg, h('div', { class: 'quota-meter' }, h('span', { class: 'quota-track', 'aria-hidden': 'true' }, fill), pct)), login);
  document.body.append(bar);

  function show(q) {
    if (!q) return;
    bar.hidden = false;
    document.documentElement.classList.add('has-quota');
    const used = Math.max(0, Math.min(100, q.percent ?? 0));
    fill.style.width = `${used}%`;
    pct.textContent = q.exhausted ? 'IA gratuite épuisée' : `IA gratuite : ${used} % utilisée`;
    bar.classList.toggle('low', used >= 80 && !q.exhausted);
    bar.classList.toggle('out', Boolean(q.exhausted));
    msg.textContent = q.exhausted ? 'IA gratuite épuisée : connecte-toi' : 'Connecte-toi pour garder ton CV';
  }

  window.addEventListener('salacv:quota', (e) => show(e.detail));
  fetch('/api/usage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .then((r) => r.json())
    .then((d) => d.ok && !d.loggedIn && show(d.quota))
    .catch(() => show({ percent: 0 })); // serveur injoignable : on montre quand même l'invitation à se connecter
}

export const publishQuota = (quota) => quota && window.dispatchEvent(new CustomEvent('salacv:quota', { detail: quota }));
