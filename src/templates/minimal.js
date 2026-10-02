// Template "minimal" : le style de la landing smlab (Sora + DM Mono, accent
// bleu, labels mono en capitales du type "EXPÉRIENCES / 02" dans une colonne
// de gauche).
import { block } from '../layout/engine.js';

const C = {
  text: '#1A1A18',
  soft: '#3A3A37',
  muted: '#6B6B67',
  border: '#E4E3DF',
  chipBg: '#FAFAF8',
};

const M = { top: 50, bottom: 50, left: 48, right: 48 };
const GUTTER = 112; // colonne des labels
const GAP = 18;

export const minimal = {
  id: 'minimal',
  margin: M,

  build(resume, kit, page) {
    const accent = resume.theme.accent ?? '#0066FF';
    const fullW = page.width - M.left - M.right;
    const bodyX = M.left + GUTTER + GAP;
    const bodyW = page.width - M.right - bodyX;

    const S = {
      name: { font: 'sora-600', size: 25, color: C.text, tracking: -0.5 },
      title: { font: 'sora-400', size: 11.5, color: accent },
      contact: { font: 'mono-400', size: 7.8, color: C.muted },
      badge: { font: 'mono-400', size: 7.2, color: C.muted },
      summary: { font: 'sora-300', size: 9.4, color: C.soft },
      label: { font: 'mono-400', size: 7.2, color: C.muted, tracking: 1.1 },
      itemTitle: { font: 'sora-500', size: 10, color: C.text },
      period: { font: 'mono-400', size: 7.4, color: C.muted },
      org: { font: 'sora-400', size: 8.8, color: accent },
      place: { font: 'sora-300', size: 8.8, color: C.muted },
      bullet: { font: 'sora-300', size: 8.9, color: C.soft },
      chip: { font: 'mono-400', size: 7.6, color: C.text },
      groupLabel: { font: 'mono-400', size: 6.8, color: C.muted, tracking: 0.8 },
      listName: { font: 'sora-400', size: 9.2, color: C.text },
      listLevel: { font: 'mono-400', size: 7.2, color: C.muted, tracking: 0.6 },
    };

    const blocks = [header()];
    for (const section of resume.sections) blocks.push(...sectionBlocks(section));
    return blocks;

    function header() {
      const ops = [];
      const p = resume.profile;
      let y = 0;

      if (p.badge) {
        const tw = kit.width(p.badge, S.badge);
        const h = 16;
        ops.push({ t: 'rect', x: M.left, y, w: tw + 26, h, r: h / 2, fill: C.chipBg, stroke: C.border, lw: 0.75 });
        ops.push({ t: 'circle', cx: M.left + 9.5, cy: y + h / 2, r: 2.1, fill: accent });
        kit.text(ops, p.badge, M.left + 17, kit.baseline(y, S.badge, h), S.badge);
        y += h + 14;
      }

      y += kit.paragraph(ops, p.name, M.left, y, fullW, S.name, 30);
      if (p.title) y += 2 + kit.paragraph(ops, p.title, M.left, y + 2, fullW, S.title, 16);

      const contacts = [p.email, p.phone, p.location, ...p.links.map((l) => l.label)].filter(Boolean);
      if (contacts.length) y += 8 + kit.paragraph(ops, contacts.join('  ·  '), M.left, y + 8, fullW, S.contact, 12);

      if (p.summary) y += 12 + kit.paragraph(ops, p.summary, M.left, y + 12, fullW * 0.86, S.summary, 14.2);

      y += 20;
      ops.push({ t: 'line', x1: M.left, y1: y, x2: M.left + fullW, y2: y, color: C.border, lw: 0.75 });
      return block(ops, y, { gapAfter: 22 });
    }

    // Le label de section est un bloc de hauteur 0 lié au premier élément,
    // pour ne jamais rester seul en bas de page.
    function labelBlock(section, count) {
      const ops = [];
      const text = (count ? `${section.title} / ${String(count).padStart(2, '0')}` : section.title).toUpperCase();
      kit.paragraph(ops, text, M.left, 1, GUTTER, S.label, 12);
      return block(ops, 0, { keepWithNext: true });
    }

    function sectionBlocks(section) {
      let items;
      switch (section.type) {
        case 'timeline':
          items = section.items.map(timelineItem);
          break;
        case 'tags':
          items = section.groups.map(tagGroup);
          break;
        case 'list':
          items = [listGrid(section.items)];
          break;
        case 'text': {
          const ops = [];
          const h = kit.paragraph(ops, section.body, bodyX, 0, bodyW, S.summary, 14.2);
          items = [block(ops, h)];
          break;
        }
      }
      if (!items.length) return [];
      items.forEach((b, i) => (b.gapAfter = i === items.length - 1 ? 26 : b.gapAfter));
      const count = section.type === 'timeline' ? section.items.length : 0;
      return [labelBlock(section, count), ...items];
    }

    function timelineItem(item) {
      const ops = [];
      let y = 0;

      const periodW = item.period ? kit.width(item.period, S.period) : 0;
      const titleW = bodyW - (periodW ? periodW + 14 : 0);
      if (item.period) kit.text(ops, item.period, bodyX + bodyW - periodW, kit.baseline(0, S.period, 14), S.period);
      y += kit.paragraph(ops, item.title, bodyX, y, titleW, S.itemTitle, 14);

      if (item.org || item.location) {
        let x = bodyX;
        const base = kit.baseline(y, S.org, 13);
        if (item.org) {
          kit.text(ops, item.org, x, base, S.org);
          x += kit.width(item.org, S.org);
        }
        if (item.location) kit.text(ops, `${item.org ? '  ·  ' : ''}${item.location}`, x, base, S.place);
        y += 13;
      }

      if (item.bullets.length) y += 4;
      for (const b of item.bullets) {
        const mid = y + 13 / 2 + 0.5;
        ops.push({ t: 'line', x1: bodyX + 1, y1: mid, x2: bodyX + 5.5, y2: mid, color: accent, lw: 0.9 });
        y += kit.paragraph(ops, b, bodyX + 12, y, bodyW - 12, S.bullet, 13) + 1.5;
      }
      return block(ops, y, { gapAfter: 14 });
    }

    function tagGroup(group) {
      const ops = [];
      let y = 0;
      if (group.label) y += kit.paragraph(ops, group.label.toUpperCase(), bodyX, 0, bodyW, S.groupLabel, 11) + 4;

      const h = 15;
      const padX = 6.5;
      let x = bodyX;
      for (const item of group.items) {
        const w = kit.width(item, S.chip) + padX * 2;
        if (x > bodyX && x + w > bodyX + bodyW) {
          x = bodyX;
          y += h + 4;
        }
        ops.push({ t: 'rect', x, y, w, h, r: 3.5, fill: C.chipBg, stroke: C.border, lw: 0.75 });
        kit.text(ops, item, x + padX, kit.baseline(y, S.chip, h), S.chip);
        x += w + 4;
      }
      y += group.items.length ? h : 0;
      return block(ops, y, { gapAfter: 10 });
    }

    function listGrid(items) {
      const ops = [];
      const colW = bodyW / 2;
      const lh = 16;
      items.forEach((item, i) => {
        const x = bodyX + (i % 2) * colW;
        const top = Math.floor(i / 2) * lh;
        const base = kit.baseline(top, S.listName, lh);
        kit.text(ops, item.name, x, base, S.listName);
        if (item.level) kit.text(ops, item.level.toUpperCase(), x + kit.width(item.name, S.listName) + 8, base, S.listLevel);
      });
      return block(ops, Math.ceil(items.length / 2) * lh);
    }
  },
};
