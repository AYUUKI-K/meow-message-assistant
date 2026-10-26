type Color = [number, number, number, number];

const luminance = (c: Color) => c.slice(0, 3).map(v => {
  const s = v / 255;
  return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
}).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const mix = (a: Color, b: Color, weight: number): Color => [
  ...a.slice(0, 3).map((v, i) => Math.round(v * weight + b[i] * (1 - weight))), 1,
] as Color;
const opaque = (a: Color, b: Color) => mix(a, b, a[3]);
const css = (c: Color) => `rgba(${c[0]},${c[1]},${c[2]},${c[3]})`;

/** Sample the host's resolved CSS, including custom styles, without inheriting its layout rules. */
export function createNativeTheme(page: Window, host: HTMLElement, onChange: () => void) {
  const doc = page.document;
  const probe = doc.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'all:initial;position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden';
  doc.body.appendChild(probe);
  const canvas = doc.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const media = page.matchMedia('(prefers-color-scheme: dark)');
  let palette: Record<string, string> = {};
  let signature = '';
  let frame = 0;
  let stopped = false;
  const sample = (value: string, fallback: Color): Color => {
    if (!value) return fallback;
    probe.style.removeProperty('color');
    probe.style.setProperty('color', value, 'important');
    if (!probe.style.color) return fallback;
    const resolved = page.getComputedStyle(probe).color;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = resolved;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, alpha] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, alpha / 255];
  };
  const update = () => {
    frame = 0;
    if (stopped) return;
    const body = page.getComputedStyle(doc.body);
    const read = (name: string, fallback: Color) => sample(body.getPropertyValue(name).trim(), fallback);
    const text = read('--SmartThemeBodyColor', sample(body.color, media.matches ? [230, 230, 230, 1] : [35, 35, 35, 1]));
    const base: Color = luminance(text) > .4 ? [24, 24, 24, 1] : [248, 248, 248, 1];
    const surface = opaque(read('--SmartThemeBlurTintColor', sample(body.backgroundColor, base)), base);
    const ink = opaque(text, surface);
    const primary = opaque(read('--SmartThemeQuoteColor', ink), surface);
    const black: Color = [0, 0, 0, 1], white: Color = [255, 255, 255, 1];
    const contrast = (a: Color, b: Color) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    const onPrimary = contrast(primary, black) >= contrast(primary, white) ? black : white;
    const catFace = contrast(primary, surface) >= 3 ? primary : ink;
    const catDetails = contrast(catFace, black) >= contrast(catFace, white) ? black : white;
    const mode = luminance(surface) < .35 ? 'dark' : 'light';
    const native = ['Body', 'Em', 'Underline', 'Quote', 'BlurTint', 'ChatTint', 'Border', 'Shadow'];
    palette = {
      '--ink': css(ink), '--surface': css(surface),
      '--muted': css(mix(ink, surface, .72)),
      '--control': css(mix(ink, surface, .06)),
      '--line': css(opaque(read('--SmartThemeBorderColor', mix(ink, surface, .25)), surface)),
      '--accent': css(mix(primary, surface, .16)),
      '--primary': css(primary), '--on-primary': css(onPrimary), '--focus': css(primary),
      '--shadow': css(read('--SmartThemeShadowColor', [0, 0, 0, .25])),
      '--cat-face': css(catFace), '--cat-ear': css(catDetails), '--cat-line': css(ink),
      '--cat-paper': css(mix(ink, surface, .06)),
      '--bg': css(surface), '--text': css(ink), '--link': css(primary),
      '--border': css(mix(ink, surface, .25)), '--quote': css(primary),
      '--em': css(opaque(read('--SmartThemeEmColor', mix(ink, surface, .8)), surface)),
    };
    for (const name of native) {
      const key = `--SmartTheme${name}Color`;
      const value = body.getPropertyValue(key).trim();
      if (value) palette[key] = css(sample(value, ink));
    }
    const next = JSON.stringify([mode, palette]);
    if (next === signature) return;
    signature = next;
    host.dataset.theme = mode;
    host.style.colorScheme = mode;
    for (const [name, value] of Object.entries(palette)) host.style.setProperty(name, value);
    onChange();
  };
  const schedule = () => { if (!stopped && !frame) frame = page.requestAnimationFrame(update); };
  const observer = new MutationObserver(schedule);
  for (const target of [doc.documentElement, doc.body])
    observer.observe(target, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
  observer.observe(doc.head, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href', 'media', 'disabled'] });
  const customStyle = doc.getElementById('custom-style');
  if (customStyle && !doc.head.contains(customStyle)) observer.observe(customStyle, { subtree: true, childList: true, characterData: true });
  const onLoad = (event: Event) => { if ((event.target as Element)?.matches?.('link[rel="stylesheet"]')) schedule(); };
  media.addEventListener('change', schedule);
  page.addEventListener('resize', schedule, { passive: true });
  doc.addEventListener('load', onLoad, true);
  return {
    update,
    readerCss: () => `:root{${Object.entries(palette).map(([k, v]) => `${k}:${v}`).join(';')};color-scheme:${host.dataset.theme || 'light'}}`,
    syncReader(inside: Document) {
      const mode = host.dataset.theme || 'light';
      inside.documentElement.dataset.theme = mode;
      inside.documentElement.style.colorScheme = mode;
      for (const [name, value] of Object.entries(palette)) inside.documentElement.style.setProperty(name, value);
    },
    destroy() {
      stopped = true;
      observer.disconnect();
      if (frame) page.cancelAnimationFrame(frame);
      media.removeEventListener('change', schedule);
      page.removeEventListener('resize', schedule);
      doc.removeEventListener('load', onLoad, true);
      probe.remove();
    },
  };
}
