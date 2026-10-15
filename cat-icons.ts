/** 当前图标为 03「来信喵」。统一使用助手的日夜配色变量；其余方案仅供预览。 */
const svg = (title: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" role="img"><title>${title}</title><g stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;

export const CAT_ICON = /* @__PURE__ */ svg('来信喵', `
      <path d="M18 31V13q0-3 3-1l8 6h8l7-6q3-2 3 1v18" fill="var(--cat-face,#7296be)"/>
      <path d="m23 26 3 1 2-1m9 0 3 1 2-1" stroke="var(--cat-ear,#f1f6ff)" stroke-width="2"/>
      <path d="m31 30 2 1 2-1" stroke="var(--cat-ear,#f1f6ff)" stroke-width="1.8"/>
      <rect x="9" y="33" width="46" height="23" rx="5" fill="var(--cat-ear,#f1f6ff)" stroke="var(--cat-line,#345577)" stroke-width="2"/>
      <path d="m10 36 18 12q4 3 8 0l18-12M11 53l13-10m29 10L40 43" stroke="var(--cat-line,#345577)" stroke-width="1.8"/>
      <path d="M21 33v5m23-5v5" stroke="var(--cat-face,#7296be)" stroke-width="6"/>
      <path d="m53 11 1.2 3.8L58 16l-3.8 1.2L53 21l-1.2-3.8L48 16l3.8-1.2Z" fill="var(--cat-face,#7296be)"/>
    `);

export const CAT_ICON_OPTIONS = [
  {
    id: 'moon', name: '月里眠', subtitle: '弯月 · 蜷睡 · 安静',
    svg: /* @__PURE__ */ svg('月里眠', `
      <path d="M47 9C26 6 10 20 12 37c2 16 20 24 33 15C28 56 19 43 22 30c3-10 12-17 25-21Z" fill="var(--cat-face,#7296be)" opacity=".24"/>
      <path d="M24 37c2-8 8-12 15-10l7-7 1 12c8 4 11 15 4 21-6 5-21 4-26-2-4-4-4-9-1-14Z" fill="var(--cat-face,#7296be)"/>
      <path d="m28 31-2-10 10 6" fill="var(--cat-face,#7296be)"/>
      <path d="M45 40c-10-5-19 5-11 10 5 3 11 0 10-3" stroke="var(--cat-ear,#f1f6ff)" stroke-width="2.2"/>
      <path d="m30 35 3 1 3-2" stroke="var(--cat-ear,#f1f6ff)" stroke-width="2"/>
      <path d="m46 10 1.5 4.5L52 16l-4.5 1.5L46 22l-1.5-4.5L40 16l4.5-1.5Z" fill="var(--cat-line,#345577)"/>
    `),
  },
  {
    id: 'mochi', name: '奶团', subtitle: '圆润 · 小耳朵 · 软糯',
    svg: /* @__PURE__ */ svg('奶团', `
      <path d="M12 29 13 12q0-3 3-1l12 9q6-1 12 0l10-9q3-2 3 2l-1 17c8 20-3 26-20 26S4 49 12 29Z" fill="var(--cat-face,#7296be)"/>
      <path d="m17 18 1 11 8-5m20-1 4-5-1 11" fill="var(--cat-ear,#f1f6ff)" opacity=".8"/>
      <path d="M28 21c-1 7 0 12 6 14 8 1 12-4 13-9-5-5-12-6-19-5Z" fill="var(--cat-line,#345577)" opacity=".2"/>
      <ellipse cx="23" cy="37" rx="2" ry="2.7" fill="var(--cat-line,#345577)"/>
      <ellipse cx="43" cy="37" rx="2" ry="2.7" fill="var(--cat-line,#345577)"/>
      <path d="m30 41 3 2 3-2m-3 2v2m-5 0q2 4 5 0 3 4 5 0" stroke="var(--cat-ear,#f1f6ff)" stroke-width="1.8"/>
      <path d="m14 40 5 1m28 0 5-1" stroke="var(--cat-ear,#f1f6ff)" stroke-width="2.5"/>
    `),
  },
  {
    id: 'letter', name: '来信喵', subtitle: '信封 · 探头 · 消息助手',
    svg: CAT_ICON,
  },
  {
    id: 'window', name: '窗边', subtitle: '侧影 · 长尾 · 绘本感',
    svg: /* @__PURE__ */ svg('窗边', `
      <path d="M12 52V29C12 4 52 4 52 29v23" stroke="var(--cat-face,#7296be)" stroke-width="2" opacity=".4"/>
      <path d="M44 19a7 7 0 0 1-9-9 7 7 0 1 0 9 9Z" fill="var(--cat-face,#7296be)" opacity=".5"/>
      <path d="M22 51c-1-6 4-12 5-18-4-2-6-6-5-10l1-7 6 5 7-3-1 8c0 4-4 7-4 8 0 4 8 8 8 17Z" fill="var(--cat-line,#345577)"/>
      <path d="M35 49c10 7 21 1 16-6-2-3-6-2-6 1" stroke="var(--cat-line,#345577)" stroke-width="4"/>
      <path d="m27 27 3 1m0 14-2 9" stroke="var(--cat-ear,#f1f6ff)" stroke-width="1.6"/>
      <path d="M10 54h45" stroke="var(--cat-face,#7296be)" stroke-width="2.2"/>
    `),
  },
  {
    id: 'peek', name: '偷偷看', subtitle: '探头 · 猫爪 · 灵动',
    svg: /* @__PURE__ */ svg('偷偷看', `
      <path d="M12 43c-5-9-2-16 1-19l1-12 12 7q6-2 12 0l12-7 1 12c5 5 7 13 1 19Z" fill="var(--cat-face,#7296be)"/>
      <path d="m18 19 1 7 6-4m16 0 5-3-1 7" fill="var(--cat-ear,#f1f6ff)" opacity=".8"/>
      <ellipse cx="24" cy="33" rx="3" ry="4" fill="var(--cat-ear,#f1f6ff)"/>
      <ellipse cx="42" cy="33" rx="3" ry="4" fill="var(--cat-ear,#f1f6ff)"/>
      <ellipse cx="25" cy="34" rx="1.3" ry="2.4" fill="var(--cat-line,#345577)"/>
      <ellipse cx="43" cy="34" rx="1.3" ry="2.4" fill="var(--cat-line,#345577)"/>
      <path d="m31 38 2 1 2-1" stroke="var(--cat-ear,#f1f6ff)" stroke-width="1.8"/>
      <path d="M8 44h48" stroke="var(--cat-line,#345577)" stroke-width="2.2"/>
      <rect x="16" y="40" width="10" height="13" rx="5" fill="var(--cat-ear,#f1f6ff)" stroke="var(--cat-line,#345577)" stroke-width="1.7"/>
      <rect x="39" y="40" width="10" height="13" rx="5" fill="var(--cat-ear,#f1f6ff)" stroke="var(--cat-line,#345577)" stroke-width="1.7"/>
      <path d="M20 47v3m3-3v3m20-3v3m3-3v3" stroke="var(--cat-face,#7296be)" stroke-width="1.2"/>
    `),
  },
  {
    id: 'bubble', name: '一声喵', subtitle: '气泡 · 极简 · 清晰',
    svg: /* @__PURE__ */ svg('一声喵', `
      <path d="M11 29V13q0-3 3-1l11 8q7-2 14 0l11-8q3-2 3 1v19c0 13-9 20-23 19l-10 6 1-9C14 44 11 38 11 29Z" fill="var(--cat-face,#7296be)"/>
      <path d="m18 20 1 8 7-4m17 0 5-4-1 8" fill="var(--cat-ear,#f1f6ff)" opacity=".6"/>
      <path d="M22 33q3-4 6 0m11 0q3-4 6 0" stroke="var(--cat-ear,#f1f6ff)" stroke-width="2.5"/>
      <path d="m31 36 2 2 2-2m-2 2v2m-5 0q2 4 5 0 3 4 5 0" stroke="var(--cat-ear,#f1f6ff)" stroke-width="1.8"/>
    `),
  },
];

