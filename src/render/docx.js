// Export Word (.docx) depuis le DSL. Word ne sait pas reproduire la mise en page Skia
// (colonnes, bandeaux) : on produit un document propre et modifiable, une colonne, dans
// l'ordre du format congolais, avec la photo et la couleur du modèle en accent.
import { BorderStyle, Document, ImageRun, Packer, Paragraph, TabStopType, TextRun } from 'docx';

const ACCENT = { minimal: '111111', bandeau: '1F2937', vitae: '1F2937', diagonale: '0F766E', epure: '111111', marine: '1E3A8A', contraste: '111111' };
const FONT = 'Calibri';
const GRAY = '4B5563';

const run = (text, o = {}) => new TextRun({ text, font: FONT, size: o.size ?? 20, bold: o.bold, color: o.color ?? '111111', italics: o.italics });

function photoRun(dataUrl) {
  const m = /^data:image\/(jpeg|png);base64,(.+)$/.exec(dataUrl ?? '');
  if (!m) return null;
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  return new ImageRun({ type: m[1] === 'png' ? 'png' : 'jpg', data: bytes, transformation: { width: 96, height: 96 } });
}

function heading(title, accent) {
  return new Paragraph({
    spacing: { before: 280, after: 100 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: accent, space: 2 } },
    children: [run(title.toUpperCase(), { bold: true, size: 22, color: accent })],
  });
}

export function resumeToDocx(resume) {
  const p = resume.profile;
  const accent = ACCENT[resume.template] ?? '111111';
  const children = [];

  const photo = photoRun(p.photo);
  if (photo) children.push(new Paragraph({ children: [photo], spacing: { after: 120 } }));
  children.push(new Paragraph({ children: [run(p.name, { bold: true, size: 40, color: accent })] }));
  if (p.title) children.push(new Paragraph({ spacing: { after: 80 }, children: [run(p.title, { size: 24, color: GRAY })] }));
  const contacts = [...(p.phones ?? []), p.email, p.address, ...(p.links ?? []).map((l) => l.label)].filter(Boolean);
  if (contacts.length) children.push(new Paragraph({ spacing: { after: 120 }, children: [run(contacts.join('   ·   '), { size: 18, color: GRAY })] }));

  if (p.summary) {
    children.push(heading('Profil professionnel', accent));
    for (const line of p.summary.split('\n').filter(Boolean)) children.push(new Paragraph({ spacing: { after: 80 }, children: [run(line, { color: '374151' })] }));
  }

  for (const section of resume.sections) {
    children.push(heading(section.title, accent));
    if (section.type === 'text') {
      children.push(new Paragraph({ children: [run(section.body, { color: '374151' })] }));
    } else if (section.type === 'timeline') {
      for (const it of section.items) {
        children.push(
          new Paragraph({
            spacing: { before: 120 },
            tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
            children: [run(it.title, { bold: true }), ...(it.period ? [run(`\t${it.period}`, { size: 18, color: GRAY })] : [])],
          }),
        );
        const place = [it.org, it.location].filter(Boolean).join(' — ');
        if (place) children.push(new Paragraph({ children: [run(place, { italics: true, color: GRAY })] }));
        for (const b of it.bullets ?? []) children.push(new Paragraph({ bullet: { level: 0 }, children: [run(b, { color: '374151' })] }));
      }
    } else if (section.type === 'list') {
      for (const it of section.items) children.push(new Paragraph({ bullet: { level: 0 }, children: [run(it.name, { bold: true }), ...(it.level ? [run(` — ${it.level}`, { color: GRAY })] : [])] }));
    } else {
      for (const it of section.items) children.push(new Paragraph({ bullet: { level: 0 }, children: [run(it, { color: '374151' })] }));
    }
  }

  return new Document({
    creator: 'salacv',
    title: `CV — ${p.name}`,
    styles: { default: { document: { run: { font: FONT } } } },
    sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } }, children }],
  });
}

// Blob dans le navigateur, Buffer dans Node.
export async function renderDocx(resume) {
  const doc = resumeToDocx(resume);
  return typeof window === 'undefined' ? Packer.toBuffer(doc) : Packer.toBlob(doc);
}
