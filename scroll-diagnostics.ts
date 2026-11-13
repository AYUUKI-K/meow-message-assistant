import { SCRIPT_VERSION } from './version';

const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
const floor = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const domFloor = (element: Element | null) => {
  const value = element?.getAttribute('mesid');
  return value && /^\d+$/.test(value) ? floor(Number(value)) : null;
};

/** Geometry only: never reads message text, chat identity, URLs, storage or credentials. */
export function scrollGeometry(page: Window, chat: HTMLElement | null, message: HTMLElement | null) {
  const measure = (element: HTMLElement | null) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = page.getComputedStyle(element);
    return {
      top: number(rect.top), height: number(rect.height), width: number(rect.width),
      scrollTop: number(element.scrollTop), scrollHeight: number(element.scrollHeight),
      clientHeight: number(element.clientHeight), clientTop: number(element.clientTop),
      offsetHeight: number(element.offsetHeight), offsetTop: number(element.offsetTop),
      zoom: number(Number(style.getPropertyValue('zoom'))),
      transform: /^matrix(?:3d)?\([-\d.,\se+]+\)$/i.test(style.transform) ? style.transform : 'none',
      overflowY: style.overflowY, flexDirection: style.flexDirection,
      overflowAnchor: style.getPropertyValue('overflow-anchor'),
      position: style.position, scrollSnapType: style.scrollSnapType,
      contentVisibility: style.getPropertyValue('content-visibility'),
    };
  };
  const ancestors = [];
  let parent = chat?.parentElement ?? null;
  for (let depth = 0; parent && depth < 6; depth++, parent = parent.parentElement) ancestors.push(measure(parent));
  const visual = page.visualViewport;
  return {
    viewport: { width: number(page.innerWidth), height: number(page.innerHeight),
      visualWidth: number(visual?.width), visualHeight: number(visual?.height),
      visualTop: number(visual?.offsetTop), visualScale: number(visual?.scale) },
    targetDomId: domFloor(message),
    targetOffsetParentIsChat: message ? message.offsetParent === chat : null,
    lastRenderedId: domFloor(chat?.querySelector('.mes.last_mes[mesid]') ?? null),
    target: measure(message), chat: measure(chat), ancestors,
    document: measure(page.document.scrollingElement as HTMLElement | null),
  };
}

export function createScrollDiagnostics(snapshot: (id?: number) => object, now = () => Date.now()) {
  let start = now();
  let events: object[] = [];
  let target: number | undefined;
  return {
    reset() { start = now(); events = []; target = undefined; },
    record(phase: string, id?: number) {
      try {
        if (floor(id) !== null) target = id;
        events.push({ phase, ms: number(now() - start), requestedId: floor(id), ...snapshot(id) });
        if (events.length > 18) events.shift();
      } catch { /* Diagnostics must not interrupt reading or generation. */ }
    },
    report() {
      let current: object;
      try { current = snapshot(target); } catch { current = { unavailable: true }; }
      return JSON.stringify({ tool: 'meow-scroll-diagnostics', version: SCRIPT_VERSION, events, current }, null, 2);
    },
  };
}
