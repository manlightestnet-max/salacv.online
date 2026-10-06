// Mobile, feuille repliée : les étapes deviennent une roue, comme un sélecteur de date. L'étape au centre
// est celle choisie ; on fait défiler, les voisines rapetissent et s'effacent, un petit « clic » (vibration)
// marque chaque passage au centre, et l'étape s'ouvre quand la roue s'arrête. Toucher une étape la
// ramène au centre ; toucher celle du centre déplie le formulaire.
//
// Mobile, feuille dépliée : glisser horizontalement sur le formulaire passe à l'étape suivante / précédente.

const mobile = window.matchMedia('(max-width: 959px)');
const calm = window.matchMedia('(prefers-reduced-motion: reduce)');

/** stepper : la barre des étapes ; sheet : la feuille (data-state) ; onSelect(i) : l'étape au centre à l'arrêt. */
export function initStepWheel(stepper, { sheet, onSelect }) {
  const on = () => mobile.matches && sheet.dataset.state === 'collapsed';
  const pills = () => [...stepper.querySelectorAll('.step-pill')];
  let centered = -1;
  let frame = 0;
  let settle = 0;

  const nearest = () => {
    const box = stepper.getBoundingClientRect();
    const mid = box.left + box.width / 2;
    let best = -1;
    let bestGap = Infinity;
    pills().forEach((pill, i) => {
      const r = pill.getBoundingClientRect();
      const gap = Math.abs(r.left + r.width / 2 - mid);
      // Plus on s'éloigne du centre, plus la pastille rapetisse et s'efface (comme une roue).
      pill.style.setProperty('--d', String(Math.min(1, gap / (box.width / 2))));
      if (gap < bestGap) [best, bestGap] = [i, gap];
    });
    return best;
  };

  const paint = () => {
    frame = 0;
    const i = nearest();
    if (i !== centered) {
      pills().forEach((pill, j) => pill.classList.toggle('centered', j === i));
      if (centered !== -1 && on() && !calm.matches) navigator.vibrate?.(6);
      centered = i;
    }
  };

  const stop = () => {
    if (!on()) return;
    const i = nearest();
    const active = pills().findIndex((p) => p.classList.contains('active'));
    if (i !== -1 && i !== active) onSelect(i);
  };

  const sync = () => {
    stepper.classList.toggle('wheel', on());
    if (on()) requestAnimationFrame(paint);
  };

  stepper.addEventListener(
    'scroll',
    () => {
      if (!on()) return;
      if (!frame) frame = requestAnimationFrame(paint);
      clearTimeout(settle);
      settle = setTimeout(stop, 160); // repli si l'événement scrollend n'existe pas
    },
    { passive: true },
  );
  stepper.addEventListener('scrollend', () => {
    clearTimeout(settle);
    stop();
  });

  // Toucher une étape qui n'est pas au centre : la roue l'y amène (le choix se fait à l'arrêt).
  stepper.addEventListener(
    'click',
    (e) => {
      if (!on()) return;
      const pill = e.target.closest('.step-pill');
      if (!pill || pill.classList.contains('centered')) return;
      e.preventDefault();
      e.stopPropagation();
      pill.scrollIntoView({ block: 'nearest', inline: 'center', behavior: calm.matches ? 'auto' : 'smooth' });
    },
    true,
  );

  // Repliée / dépliée, mobile / PC, étapes redessinées : la roue se remet en place.
  new MutationObserver(sync).observe(sheet, { attributes: true, attributeFilter: ['data-state'] });
  new MutationObserver(sync).observe(stepper, { childList: true });
  mobile.addEventListener('change', sync);
  sync();
}

/** Formulaire déplié : un glissement franc vers la gauche ou la droite change d'étape (dir : +1 / -1). */
export function initSwipeSteps(el, { enabled, onSwipe }) {
  let start = null;
  const ignore = (target) => {
    for (let n = target; n && n !== el; n = n.parentElement) {
      if (n.matches?.('input, textarea, select, [contenteditable], .no-swipe')) return true;
      // Une rangée qui défile elle-même horizontalement garde son geste (pastilles, modèles…).
      const style = getComputedStyle(n);
      if (/(auto|scroll)/.test(style.overflowX) && n.scrollWidth > n.clientWidth) return true;
    }
    return false;
  };
  el.addEventListener(
    'touchstart',
    (e) => {
      start = mobile.matches && enabled() && e.touches.length === 1 && !ignore(e.target) ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: e.timeStamp } : null;
    },
    { passive: true },
  );
  el.addEventListener(
    'touchend',
    (e) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const quick = e.timeStamp - start.t < 600;
      start = null;
      if (!quick || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
      const dir = dx < 0 ? 1 : -1;
      if (!onSwipe(dir) || calm.matches) return;
      el.classList.remove('swipe-next', 'swipe-prev');
      void el.offsetWidth;
      el.classList.add(dir > 0 ? 'swipe-next' : 'swipe-prev');
    },
    { passive: true },
  );
  el.addEventListener('animationend', () => el.classList.remove('swipe-next', 'swipe-prev'));
}
