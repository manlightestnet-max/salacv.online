// Landing, « Le meilleur de salacv » : deux démonstrations rendues par le vrai moteur (celui du studio).
//  1. L'assistant remplit le CV : quelques messages, et la page se construit section par section.
//  2. Un même CV en plusieurs langues : les versions française, anglaise et portugaise de l'exemple, côte à côte ;
//     les intitulés (Profil, Contact…) viennent des libellés de l'app, le contenu est celui de l'exemple traduit.
// Les animations ne tournent que lorsque la section est à l'écran, et jamais avec prefers-reduced-motion.
import { layoutResume } from '../src/index.js';
import { LANGS, langName } from '../src/i18n/index.js';
import { drawDoc } from './lib/engine.js';
import { h } from './dom.js';
import { EN, PT, fillScript, translated } from './landing-demo-data.js';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

function autofillDemo(root, engine, example) {
  const chat = h('div', { class: 'demo-chat', 'aria-hidden': 'true' });
  const canvas = h('canvas', { class: 'demo-paper', role: 'img', 'aria-label': 'Le CV d’exemple, rempli par l’assistant' });
  root.append(h('div', { class: 'demo-chat-wrap' }, h('div', { class: 'demo-chat-head' }, h('span', { class: 'demo-spark', 'aria-hidden': 'true' }), 'Assistant salacv'), chat), h('div', { class: 'demo-stage' }, canvas));
  const steps = fillScript(example);
  const draw = (resume) => {
    const r = layoutResume(resume, engine.fonts);
    if (r.ok) drawDoc(engine, canvas, r.doc, Math.round(canvas.parentElement.clientWidth));
  };
  const bubble = (who, text) => {
    const b = h('p', { class: `demo-msg ${who}` }, text);
    chat.append(b);
    while (chat.children.length > 4) chat.firstChild.remove();
    return b;
  };

  if (reduced()) {
    // Sans animation : la conversation et le CV terminés.
    steps.forEach((s) => (bubble('user', s.user), bubble('bot', s.reply)));
    draw(steps.at(-1).resume);
    return { redraw: () => draw(steps.at(-1).resume) };
  }

  let current = { ...steps[0].resume, profile: { ...steps[0].resume.profile, title: '' }, sections: [] };
  draw(current);
  let visible = false;
  let running = false;
  async function loop() {
    if (running) return;
    running = true;
    while (visible) {
      chat.replaceChildren();
      current = { ...steps[0].resume, profile: { ...steps[0].resume.profile, title: '' }, sections: [] };
      draw(current);
      canvas.classList.remove('done');
      for (const s of steps) {
        if (!visible) break;
        const b = bubble('user', '');
        for (let i = 1; i <= s.user.length && visible; i += 2) {
          b.textContent = s.user.slice(0, i);
          await nap(24);
        }
        b.textContent = s.user;
        await nap(350);
        const typing = bubble('bot typing', '');
        typing.append(h('span'), h('span'), h('span'));
        await nap(900);
        typing.remove();
        bubble('bot', s.reply);
        current = s.resume;
        canvas.classList.remove('pulse');
        void canvas.offsetWidth;
        canvas.classList.add('pulse');
        draw(current);
        await nap(1500);
      }
      canvas.classList.add('done');
      await nap(3200);
    }
    running = false;
  }
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) loop();
  }, { threshold: 0.35 }).observe(root);
  return { redraw: () => draw(current) };
}

// --- 2. Un CV, plusieurs langues -------------------------------------------------------------------------------
function languagesDemo(root, engine, example) {
  const versions = [
    { lang: 'fr', resume: { ...example, lang: 'fr' } },
    { lang: 'en', resume: translated(example, 'en', EN) },
    { lang: 'pt', resume: translated(example, 'pt', PT) },
  ];
  const tabs = versions.map((v, i) => h('button', { type: 'button', class: 'demo-tab', role: 'tab', 'aria-selected': String(i === 0), onClick: () => (pick(i), restart()) }, langName(v.lang)));
  const cards = versions.map((v) => h('figure', { class: 'demo-card' }, h('canvas', { class: 'demo-paper' }), h('figcaption', {}, langName(v.lang))));
  const fan = h('div', { class: 'demo-fan' }, cards);
  root.append(h('div', { class: 'demo-tabs', role: 'tablist', 'aria-label': 'Versions du CV' }, tabs), fan);
  const draw = () => {
    const w = Math.round(cards[0].clientWidth);
    versions.forEach((v, i) => {
      const r = layoutResume(v.resume, engine.fonts);
      if (r.ok) drawDoc(engine, cards[i].querySelector('canvas'), r.doc, w);
    });
  };
  let active = 0;
  function pick(i) {
    active = i;
    tabs.forEach((t, k) => t.setAttribute('aria-selected', String(k === i)));
    cards.forEach((c, k) => {
      c.style.setProperty('--pos', String((k - i + versions.length) % versions.length));
      c.classList.toggle('front', k === i);
    });
  }
  let timer = null;
  let visible = false;
  const restart = () => {
    clearInterval(timer);
    if (!reduced() && visible) timer = setInterval(() => !document.hidden && pick((active + 1) % versions.length), 2800);
  };
  pick(0);
  draw();
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    restart();
  }, { threshold: 0.3 }).observe(root);
  return { redraw: draw };
}

export function initShowcase(engine, example) {
  const fill = document.getElementById('demo-fill');
  const langs = document.getElementById('demo-langs');
  if (!fill || !langs) return;
  const names = document.getElementById('demo-lang-names');
  if (names) names.textContent = LANGS.map(langName).join(', ');
  const a = autofillDemo(fill, engine, example);
  const b = languagesDemo(langs, engine, example);
  let t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => (a.redraw(), b.redraw()), 150);
  });
}
