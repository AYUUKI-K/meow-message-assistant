export type ReadingPreferences = { hideUser: boolean; returnTop: boolean };
const KEY = 'meow-reading-preferences-v1';

export function loadReadingPreferences(page: Window): ReadingPreferences {
  try {
    const saved = JSON.parse(page.localStorage.getItem(KEY) || '{}');
    return { hideUser: saved?.hideUser === true, returnTop: saved?.returnTop === true };
  } catch { return { hideUser: false, returnTop: false }; }
}
export function saveReadingPreferences(page: Window, value: ReadingPreferences) {
  try { page.localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Keep session preferences. */ }
}

/** Hide only the message display; stored messages and model context stay intact. */
export function createUserMessageVisibility(doc: Document) {
  const style = doc.createElement('style');
  style.textContent = '#chat[data-meow-hide-user="true"] .mes[is_user="true"],#chat[data-meow-hide-user="true"] .mes[data-role="user"]{display:none!important}';
  doc.head.appendChild(style);
  let chat: HTMLElement | null = null;
  return {
    apply(next: HTMLElement | null, enabled: boolean) {
      if (chat !== next) chat?.removeAttribute('data-meow-hide-user');
      chat = next;
      if (enabled) chat?.setAttribute('data-meow-hide-user', 'true');
      else chat?.removeAttribute('data-meow-hide-user');
    },
    destroy() { chat?.removeAttribute('data-meow-hide-user'); style.remove(); },
  };
}
