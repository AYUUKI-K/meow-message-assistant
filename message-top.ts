import { contentTop, scrollMessageToTop } from './positioning';

/** Recheck only the completed message while final regex/HTML layout settles. */
export function createMessageTopReturn(page: Window, trace?: (phase: string, message: HTMLElement) => void) {
  let timers: number[] = [];
  const cancel = () => {
    timers.forEach(timer => page.clearTimeout(timer));
    timers = [];
  };
  const onKey = (event: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Escape'].includes(event.key)) cancel();
  };
  const passive = { capture: true, passive: true };
  for (const name of ['wheel', 'touchstart', 'pointerdown']) page.addEventListener(name, cancel, passive);
  page.addEventListener('keydown', onKey, true);
  return {
    align(chat: HTMLElement, message: HTMLElement, valid: () => boolean) {
      cancel();
      trace?.('before-align', message);
      if (!valid() || !scrollMessageToTop(page, chat, message)) return false;
      trace?.('after-align', message);
      // Bounded work: no whole-chat observer, historical rendering or per-frame scans.
      for (const delay of [120, 350, 800, 1500]) timers.push(page.setTimeout(() => {
        if (!valid() || !chat.isConnected || !message.isConnected || !chat.contains(message) || !message.getClientRects().length) {
          cancel();
          return;
        }
        const target = Math.max(0, Math.min(contentTop(chat, message), chat.scrollHeight - chat.clientHeight));
        if (Math.abs(chat.scrollTop - target) > 1) scrollMessageToTop(page, chat, message);
        trace?.(`after-${delay}ms`, message);
      }, delay));
      return true;
    },
    cancel,
    destroy() {
      cancel();
      for (const name of ['wheel', 'touchstart', 'pointerdown']) page.removeEventListener(name, cancel, true);
      page.removeEventListener('keydown', onKey, true);
    },
  };
}
