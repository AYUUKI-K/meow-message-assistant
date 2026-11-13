export function findCurrentFloor(
  page: Window & typeof globalThis,
  doc: Document,
  chat: HTMLElement | null,
  messages: HTMLElement[],
): HTMLElement | null {
  if (!chat || !chat.getClientRects().length) return null;
  const bounds = chat.getBoundingClientRect();
  const top = Math.max(bounds.top + chat.clientTop, 0);
  const bottom = Math.min(bounds.top + chat.clientTop + chat.clientHeight, page.innerHeight);
  if (bottom <= top) return null;
  const line = top + Math.min(72, (bottom - top) * 0.2);

  // Prefer the element actually under the reading line, including message iframes.
  for (const ratio of [0.5, 0.25, 0.75]) {
    const x = Math.max(0, Math.min(page.innerWidth - 1, bounds.left + bounds.width * ratio));
    for (const hit of doc.elementsFromPoint(x, line)) {
      const element = hit.closest('.mes[mesid]') as HTMLElement | null;
      if (element && chat.contains(element) && /^\d+$/.test(element.getAttribute('mesid') ?? '')) return element;
    }
  }

  // If the reading line falls in whitespace between messages, locate the nearest floor by DOM order.
  let nearest: HTMLElement | null = null;
  let distance = Infinity;
  let low = 0;
  let high = messages.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    let index = middle;
    while (index <= high && (!messages[index].isConnected || messages[index].getBoundingClientRect().height <= 0))
      index++;
    if (index > high) {
      high = middle - 1;
      continue;
    }
    const element = messages[index];
    const rect = element.getBoundingClientRect();
    if (rect.top <= line && rect.bottom > line) return element;
    const gap = Math.min(Math.abs(rect.top - line), Math.abs(rect.bottom - line));
    if (rect.bottom > top && rect.top < bottom && gap < distance) {
      distance = gap;
      nearest = element;
    }
    if (rect.bottom <= line) low = index + 1;
    else high = index - 1;
  }
  return nearest;
}

export function contentTop(chat: HTMLElement, element: HTMLElement): number {
  const rect = chat.getBoundingClientRect();
  // Rects include theme zoom/transforms; scrollTop and clientTop use layout pixels.
  const scale = chat.offsetHeight > 0 ? rect.height / chat.offsetHeight : 1;
  const units = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return chat.scrollTop + (element.getBoundingClientRect().top - rect.top) / units - chat.clientTop;
}

export function viewportBounds(page: Window & typeof globalThis) {
  const visual = page.visualViewport;
  return {
    x: visual?.offsetLeft ?? 0,
    y: visual?.offsetTop ?? 0,
    width: visual?.width ?? page.innerWidth,
    height: visual?.height ?? page.innerHeight,
  };
}

/** Align in the chat's own scroll coordinates, including scaled Tavern themes. */
export function scrollMessageToTop(page: Window, chat: HTMLElement, message: HTMLElement): boolean {
  if (!chat.isConnected || !message.isConnected || !chat.contains(message) || !message.getClientRects().length) return false;
  const target = contentTop(chat, message);
  const max = Math.max(0, chat.scrollHeight - chat.clientHeight);
  const jquery = (page as any).jQuery;
  if (typeof jquery === 'function') jquery(chat).stop(true);
  // Long smooth animations can race streaming auto-scroll and post-render layout changes.
  chat.scrollTo({ top: Math.max(0, Math.min(target, max)), behavior: 'instant' as ScrollBehavior });
  return true;
}
