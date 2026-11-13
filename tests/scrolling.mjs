import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(process.env.MEOW_BUILD_TOOLS
  ? join(resolve(process.env.MEOW_BUILD_TOOLS), 'package.json') : import.meta.url);
const { build } = require('esbuild');
async function source(name) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(`../${name}.ts`, import.meta.url))], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { contentTop, scrollMessageToTop } = await source('positioning');
const { createMessageTopReturn } = await source('message-top');
const { createGenerationReturn } = await source('generation-return');
const { createScrollDiagnostics, scrollGeometry } = await source('scroll-diagnostics');
function clock(base = {}) {
  let now = 0, next = 0;
  const timers = new Map(), listeners = new Map();
  const page = {
    ...base,
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, time: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
  };
  return {
    page, timers, listeners,
    input(name, event = {}) { for (const fn of listeners.get(name) ?? []) fn(event); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const entry = [...timers].filter(([, value]) => value.time <= end).sort((a, b) => a[1].time - b[1].time)[0];
        if (!entry) break;
        const [id, value] = entry; timers.delete(id); now = value.time; value.fn();
      }
      now = end;
    },
  };
}
function layout({ scale = 1, top = 4200, height = 48000, scroll = top + height - 600 } = {}) {
  const calls = [];
  const chat = {
    isConnected: true, clientTop: 2, offsetHeight: 604, clientHeight: 600,
    scrollHeight: top + height, scrollTop: scroll,
    contains: node => node === message,
    getBoundingClientRect: () => ({ top: 30, height: 604 * scale }),
    scrollTo(options) { calls.push(options); this.scrollTop = Math.max(0, Math.min(options.top, this.scrollHeight - this.clientHeight)); },
  };
  const message = {
    isConnected: true,
    getClientRects: () => [message.getBoundingClientRect()],
    getBoundingClientRect: () => ({ top: 30 + (chat.clientTop + top - chat.scrollTop) * scale, height: height * scale }),
  };
  let stopped = 0;
  const page = { jQuery: () => ({ stop: () => stopped++ }), matchMedia: () => ({ matches: false }) };
  return { chat, message, page, calls, setTop: value => { top = value; chat.scrollHeight = top + height; }, stopped: () => stopped };
}
for (const scale of [1, 1.25, 2, 0.8]) {
  test(`long-message top uses scroll coordinates at scale ${scale}`, () => {
    const f = layout({ scale });
    assert.ok(Math.abs(contentTop(f.chat, f.message) - 4200) < 1);
    assert.equal(scrollMessageToTop(f.page, f.chat, f.message), true);
    assert.ok(Math.abs(f.chat.scrollTop - 4200) < 1);
  });
}
test('completed output returns immediately instead of racing a long smooth scroll', () => {
  const f = layout();
  scrollMessageToTop(f.page, f.chat, f.message);
  assert.equal(f.calls[0].behavior, 'instant');
  assert.equal(f.stopped(), 1);
});
test('short final message clamps to the available scroll range', () => {
  const f = layout({ top: 4200, height: 200, scroll: 0 });
  scrollMessageToTop(f.page, f.chat, f.message);
  assert.equal(f.chat.scrollTop, 3800);
});
test('late regex layout is corrected for the same floor with bounded work', () => {
  const f = layout({ scale: 1.25 }), c = clock(f.page);
  const anchor = createMessageTopReturn(c.page);
  assert.equal(anchor.align(f.chat, f.message, () => true), true);
  f.setTop(1600);
  c.advance(120);
  assert.equal(f.chat.scrollTop, 1600);
  c.advance(1500);
  assert.equal(f.calls.length, 2, 'stable layout does not trigger repeated scrolling');
  assert.equal(c.timers.size, 0);
  f.setTop(800);
  c.advance(10000);
  assert.equal(f.chat.scrollTop, 1600, 'no persistent position lock');
  anchor.destroy();
  assert.ok([...c.listeners.values()].every(list => !list.size));
});
for (const [name, event] of [['wheel', {}], ['touchstart', {}], ['pointerdown', {}], ['keydown', { key: 'PageUp' }]]) {
  test(`${name} lets the user take control without later jumps`, () => {
    const f = layout(), c = clock(f.page), anchor = createMessageTopReturn(c.page);
    anchor.align(f.chat, f.message, () => true);
    c.input(name, event);
    f.chat.scrollTop = 600;
    c.advance(2000);
    assert.equal(f.chat.scrollTop, 600);
    anchor.destroy();
  });
}
for (const reason of ['disabled', 'detached', 'cancelled']) {
  test(`${reason} cancels pending alignment`, () => {
    const f = layout(), c = clock(f.page), anchor = createMessageTopReturn(c.page);
    let valid = true;
    anchor.align(f.chat, f.message, () => valid);
    if (reason === 'disabled') valid = false;
    else if (reason === 'detached') f.message.isConnected = false;
    else anchor.cancel();
    f.chat.scrollTop = 1000;
    c.advance(2000);
    assert.equal(f.chat.scrollTop, 1000);
    assert.equal(c.timers.size, 0);
    anchor.destroy();
  });
}
test('receipt index wins over latest visible/ended floor and duplicate events do not repeat return', () => {
  const c = clock(), calls = [];
  const messages = new Map([[112, { id: 112, text: 'new output'.repeat(10000), swipe: 0 }], [116, { id: 116, text: 'later', swipe: 0 }]]);
  const g = createGenerationReturn({ page: c.page, identity: () => 'chat', enabled: () => true,
    output: id => messages.get(id ?? 116), returnTo: id => { calls.push(id); return true; } });
  g.start(); g.received(112); g.complete(); g.rendered(112); c.advance(100);
  assert.deepEqual(calls, [112]);
  g.received(112); c.advance(100);
  assert.deepEqual(calls, [112]);
});
test('generation restart, stop and chat switch cancel post-render correction', () => {
  const c = clock(); let cancelled = 0, identity = 'a';
  const calls = [];
  const g = createGenerationReturn({ page: c.page, identity: () => identity, enabled: () => true,
    output: id => ({ id: id ?? 112, text: 'output', swipe: 0 }),
    returnTo: id => { calls.push(id); return true; }, cancelReturn: () => cancelled++ });
  g.start(); g.received(112); g.stop(); c.advance(1000);
  assert.deepEqual(calls, []);
  g.start(); g.received(112); identity = 'b'; g.cancel(); c.advance(1000);
  assert.deepEqual(calls, []);
  assert.equal(cancelled, 4);
});
test('geometry diagnostics do not access chat text, page URLs, cookies or storage', () => {
  const f = layout({ scale: 1.25 });
  f.message.getAttribute = key => key === 'mesid' ? '112' : null;
  f.chat.querySelector = () => f.message;
  const style = { transform: 'matrix(1.25, 0, 0, 1.25, 0, 0)', overflowY: 'auto', flexDirection: 'column',
    getPropertyValue: key => key === 'zoom' ? '1.25' : 'auto' };
  const page = { ...f.page, innerWidth: 390, innerHeight: 280,
    visualViewport: { width: 320, height: 230, offsetTop: 20, scale: 1.2 },
    document: { scrollingElement: f.chat }, getComputedStyle: () => style };
  for (const [object, key] of [[f.message, 'textContent'], [page, 'location'], [page, 'localStorage'], [page.document, 'cookie']])
    Object.defineProperty(object, key, { get() { throw new Error(`private data accessed: ${key}`); } });
  const result = scrollGeometry(page, f.chat, f.message);
  assert.equal(result.targetDomId, 112);
  assert.equal(result.lastRenderedId, 112);
  assert.equal(result.viewport.visualHeight, 230);
  assert.equal(result.chat.height, 755);
  assert.doesNotMatch(JSON.stringify(result), /textContent|location|cookie|localStorage/);
});
test('diagnostic buffer is bounded and remeasures the last target when copied later', () => {
  let time = 0;
  const diagnostics = createScrollDiagnostics(id => ({ target: id ?? null, height: time }), () => time);
  for (let i = 0; i < 40; i++) { time++; diagnostics.record('sample', 112); }
  time = 5000;
  const report = JSON.parse(diagnostics.report());
  assert.equal(report.events.length, 18);
  assert.equal(report.current.target, 112);
  assert.equal(report.current.height, 5000);
  diagnostics.reset();
  assert.equal(JSON.parse(diagnostics.report()).events.length, 0);
  assert.equal(JSON.parse(diagnostics.report()).current.target, null);
});
test('unavailable diagnostic geometry never interrupts the script', () => {
  const diagnostics = createScrollDiagnostics(() => { throw new Error('detached'); });
  assert.doesNotThrow(() => diagnostics.record('sample', 112));
  assert.equal(JSON.parse(diagnostics.report()).current.unavailable, true);
});
