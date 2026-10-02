// Registre de polices partagé par le layout et les deux renderers.
// Les largeurs sont calculées à partir des avances brutes du cmap (sans
// ligatures ni kerning), exactement ce que dessinent Skia (drawText) et
// pdf-lib (avec ligatures désactivées). L'écran et le PDF coupent donc les
// lignes aux mêmes endroits.
import fontkit from '@pdf-lib/fontkit';

export const FONT_FILES = {
  'sora-300': 'Sora_300Light.ttf',
  'sora-400': 'Sora_400Regular.ttf',
  'sora-500': 'Sora_500Medium.ttf',
  'sora-600': 'Sora_600SemiBold.ttf',
  'mono-400': 'DMMono_400Regular.ttf',
  'mono-500': 'DMMono_500Medium.ttf',
};

// Désactive toute substitution pour que pdf-lib encode glyphe par caractère.
export const NO_SHAPING = { liga: false, rlig: false, clig: false, calt: false, dlig: false, kern: false };

// load(fileName) -> ArrayBuffer | Uint8Array (fs en Node, fetch dans le navigateur).
export async function loadFontSet(load) {
  const entries = await Promise.all(
    Object.entries(FONT_FILES).map(async ([key, file]) => [key, new Uint8Array(await load(file))]),
  );
  return createFontSet(Object.fromEntries(entries));
}

export function createFontSet(bytes) {
  const faces = {};
  const widthCache = {};
  for (const [key, b] of Object.entries(bytes)) {
    faces[key] = fontkit.create(b);
    widthCache[key] = new Map();
  }

  function face(key) {
    const f = faces[key];
    if (!f) throw new Error(`Police inconnue : ${key}`);
    return f;
  }

  function advance(key, cp) {
    const cache = widthCache[key];
    let w = cache.get(cp);
    if (w === undefined) {
      const f = face(key);
      w = f.glyphForCodePoint(cp).advanceWidth / f.unitsPerEm;
      cache.set(cp, w);
    }
    return w;
  }

  return {
    bytes,
    // Largeur en points de `text` à la taille `size`, avec `tracking` (pt) entre caractères.
    measure(text, key, size, tracking = 0) {
      let w = 0;
      let n = 0;
      for (const ch of text) {
        w += advance(key, ch.codePointAt(0));
        n++;
      }
      return w * size + (n > 1 ? tracking * (n - 1) : 0);
    },
    capHeight(key, size) {
      const f = face(key);
      return (f.capHeight / f.unitsPerEm) * size;
    },
    // Remplace les caractères absents de la police (emoji, etc.) pour éviter
    // les carrés vides dans le PDF.
    sanitize(text, key) {
      const f = face(key);
      let out = '';
      for (const ch of text) out += f.hasGlyphForCodePoint(ch.codePointAt(0)) || ch === ' ' ? ch : '';
      return out;
    },
  };
}
