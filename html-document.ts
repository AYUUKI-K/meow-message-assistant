type HtmlDocumentOptions = {
  page: Window & typeof globalThis;
  doc: Document;
  host: HTMLElement;
  preserveLineBreaks: (root: HTMLElement) => void;
};

type DocumentCallbacks = {
  onInteraction?: () => void;
  onEscape?: () => void;
};

// This function is serialized into each document; keep it independent of module state.
function documentBridge({ token, theme }: { token: string; theme: string }) {
  const send = (type: string, extra: Record<string, unknown> = {}) =>
    window.parent.postMessage({ type, token, ...extra }, '*');
  const setTheme = (value: string) => {
    document.documentElement.dataset.theme = value;
    document.documentElement.style.colorScheme = value;
  };
  setTheme(theme);

  // Opaque-origin frames cannot use persistent storage. Local UI preferences still work in memory.
  for (const name of ['localStorage', 'sessionStorage']) {
    const values = new Map<string, string>();
    const storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(String(key)) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(String(key)),
      setItem: (key: string, value: string) => values.set(String(key), String(value)),
    };
    Object.defineProperty(window, name, { configurable: true, value: storage });
  }

  let pending = false;
  let previousHeight = 0;
  const resize = () => {
    if (pending) return;
    pending = true;
    // Frames below the reader's visible area can pause animation frames before their first resize.
    setTimeout(() => {
      pending = false;
      const body = document.body;
      if (!body) return;
      const bounds = body.getBoundingClientRect();
      const style = getComputedStyle(body);
      let contentHeight = bounds.height;
      for (const child of body.children) {
        if (/^(SCRIPT|STYLE|LINK|META)$/.test(child.tagName) || getComputedStyle(child).position === 'fixed') continue;
        contentHeight = Math.max(contentHeight, child.getBoundingClientRect().bottom - bounds.top);
      }
      const height = Math.max(
        1,
        Math.ceil(contentHeight + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0)),
      );
      if (height !== previousHeight) {
        previousHeight = height;
        send('meow-html-height', { height });
      }
    }, 0);
  };

  const observeBody = () => {
    if (!document.body) return false;
    new ResizeObserver(resize).observe(document.body);
    new MutationObserver(resize).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    resize();
    return true;
  };
  if (!observeBody()) {
    const bodyObserver = new MutationObserver(() => {
      if (observeBody()) bodyObserver.disconnect();
    });
    bodyObserver.observe(document.documentElement, { childList: true });
  }
  window.addEventListener('load', () => {
    // The reader can finish laying out after a cached child document has already loaded.
    for (const delay of [0, 100, 500]) setTimeout(resize, delay);
  });
  window.addEventListener('resize', resize);
  document.fonts.ready.then(resize);
  document.addEventListener('toggle', resize, true);
  document.addEventListener('transitionend', resize, true);
  document.addEventListener('animationend', resize, true);
  document.addEventListener('submit', event => event.preventDefault(), true);
  document.addEventListener('click', event => {
    const link = (event.target as Element).closest?.('a[href]');
    if (link && !link.getAttribute('href')?.startsWith('#')) event.preventDefault();
    send('meow-html-interaction');
    resize();
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      setTimeout(() => {
        if (!event.defaultPrevented) send('meow-html-escape');
      }, 0);
    }
  });
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.token !== token || event.data?.type !== 'meow-html-theme') return;
    setTheme(event.data.theme === 'dark' ? 'dark' : 'light');
    resize();
  });
}

export function createHtmlDocumentRenderer({ page, doc, host, preserveLineBreaks }: HtmlDocumentOptions) {
  const frames = new Map<string, HTMLIFrameElement>();
  let stopListening: (() => void) | null = null;

  const createFragment = (markup: string) => {
    const container = doc.createElement('div');
    container.className = 'bird-html-fragment';
    const storage = doc.createElement('template');
    storage.dataset.birdDocument = '';
    // Text storage keeps authored handlers and scripts inert until they enter their isolated frame.
    storage.content.appendChild(doc.createTextNode(markup));
    container.appendChild(storage);
    return container.outerHTML;
  };

  const prepareDocuments = (root: DocumentFragment) => {
    for (const storage of root.querySelectorAll<HTMLTemplateElement>('template[data-bird-document]')) {
      const parsed = new page.DOMParser().parseFromString(storage.content.textContent ?? '', 'text/html');
      parsed.querySelectorAll('base,meta[http-equiv]').forEach(element => element.remove());
      preserveLineBreaks(parsed.body);
      storage.content.replaceChildren(doc.createTextNode('<!doctype html>' + parsed.documentElement.outerHTML));
    }
  };

  const unmountDocuments = () => {
    stopListening?.();
    stopListening = null;
    for (const frame of frames.values()) {
      frame.onload = null;
      frame.remove();
    }
    frames.clear();
  };

  const syncDocumentTheme = (inside: Document) => {
    for (const [token, frame] of frames) {
      if (frame.ownerDocument === inside)
        frame.contentWindow?.postMessage({ type: 'meow-html-theme', token, theme: host.dataset.theme ?? 'light' }, '*');
    }
  };

  const mountDocuments = (inside: Document, callbacks: DocumentCallbacks = {}) => {
    unmountDocuments();
    const view = inside.defaultView!;
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data.token !== 'string') return;
      const frame = frames.get(data.token);
      if (!frame || event.source !== frame.contentWindow) return;
      if (data.type === 'meow-html-height' && Number.isFinite(data.height)) {
        frame.style.height = `${Math.max(1, Math.min(200000, Math.ceil(data.height)))}px`;
        frame.dataset.birdReady = 'true';
      } else if (data.type === 'meow-html-interaction') callbacks.onInteraction?.();
      else if (data.type === 'meow-html-escape') callbacks.onEscape?.();
    };
    view.addEventListener('message', onMessage);
    stopListening = () => view.removeEventListener('message', onMessage);

    for (const storage of inside.querySelectorAll<HTMLTemplateElement>('template[data-bird-document]')) {
      const parsed = new page.DOMParser().parseFromString(storage.content.textContent ?? '', 'text/html');
      const token = page.crypto.randomUUID();
      const charset = parsed.createElement('meta');
      charset.setAttribute('charset', 'utf-8');
      const viewport = parsed.createElement('meta');
      viewport.name = 'viewport';
      viewport.content = 'width=device-width,initial-scale=1';
      const policy = parsed.createElement('meta');
      policy.httpEquiv = 'Content-Security-Policy';
      policy.content =
        "default-src 'none'; img-src https: http: data: blob:; style-src 'unsafe-inline' https: http:; font-src https: http: data:; script-src 'unsafe-inline' https: http: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
      const style = parsed.createElement('style');
      style.textContent =
        'html,body{height:auto!important;min-height:0!important}body{margin:0;overflow-wrap:anywhere;font:16px/1.8 system-ui,-apple-system,sans-serif}img,svg,video{max-width:100%;height:auto}content,meow_fm,snow{display:block}';
      const bootstrap = parsed.createElement('script');
      bootstrap.textContent = `(${documentBridge.toString()})(${JSON.stringify({ token, theme: host.dataset.theme ?? 'light' })});`;
      parsed.head.prepend(charset, viewport, policy, style, bootstrap);

      const frame = inside.createElement('iframe');
      frame.className = 'bird-html-frame';
      frame.title = parsed.title || '消息 HTML 状态栏';
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.referrerPolicy = 'no-referrer';
      frame.style.cssText = 'display:block;width:100%;height:1px;border:0;background:transparent';
      frame.onload = () => syncDocumentTheme(inside);
      frames.set(token, frame);
      storage.replaceWith(frame);
      frame.srcdoc = '<!doctype html>' + parsed.documentElement.outerHTML;
    }
  };

  return { createFragment, prepareDocuments, mountDocuments, unmountDocuments, syncDocumentTheme };
}
