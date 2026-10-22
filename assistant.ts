import { collectArchiveRows, messagePreview, renderArchivePage, renderBookmarkPage } from './archive';
import { createMessageAccess } from './message-access';
import { createMessageRenderer } from './message-renderer';
import { contentTop as getContentTop, findCurrentFloor, viewportBounds } from './positioning';
import { createAssistantUi } from './ui';
import { createAutoReader } from './auto-reader';
import { bindDockDrag } from './dock-drag';

const KEY = '__birdFloorNavigator_v1__';
const POSITION_KEY = 'bird-floor-position-v1';

export function startAssistant(): void {
  let page: any;
  try {
    page = window.parent;
    void page.document.body;
  } catch (error) {
    console.error('[喵喵消息助手] 无法访问酒馆主页面', error);
    return;
  }
  const doc: Document = page.document;
  page[KEY]?.destroy();
  const cleanups = [];
  let disposed = false;
  let history = [];
  let busy = false;
  let generation = 0;
  let frame = 0;
  let scanPending = false;
  let observedLast = -1;
  let readerState = null;
  let readerLoad = 0;
  let generating = false;
  let refreshTimer = 0;
  let archiveMode = false;
  let collectionMode = 'replies';
  let archivePage = 0;
  let archiveRows = [];
  let bookmarkRows = [];
  let searchTimer = 0;
  const renderCache = new Map();
  let renderPipeline = [];
  let layoutFrame = 0;
  let chat = null;
  let messages = [];
  let identity = '';
  let bookmarkedIds = new Map<number, string>();
  let bookmarkTitleFloor: number | null = null;
  let highlighted = null;
  let highlightTimer = 0;
  let position = null;
  try {
    position = JSON.parse(page.localStorage.getItem(POSITION_KEY));
  } catch (_) {
    /* 存储不可用时使用默认位置 */
  }

  const { host, shadow, $, ui, reader, archive } = createAssistantUi(doc);
  let toastTimer = 0;
  const listen = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    cleanups.push(() => target.removeEventListener(type, fn, options));
  };
  const themeMedia = page.matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = () => {
    host.dataset.theme = themeMedia.matches ? 'dark' : 'light';
    try {
      const inside = reader.frame.contentDocument;
      if (inside) {
        inside.documentElement.dataset.theme = host.dataset.theme;
        messageRenderer.syncDocumentTheme(inside);
      }
    } catch (_) {
      /* 等待正文载入 */
    }
  };
  listen(themeMedia, 'change', applyTheme);
  const context = () => {
    try {
      return page.SillyTavern?.getContext?.() ?? (typeof SillyTavern !== 'undefined' ? SillyTavern : null);
    } catch (_) {
      return null;
    }
  };
  const chatKey = ctx => (ctx ? `${ctx.characterId ?? ''}|${ctx.groupId ?? ''}|${ctx.getCurrentChatId?.() ?? ''}` : '');
  const bookmarkStorageKey = key => `meow-message-bookmarks-v1:${key}`;
  const loadBookmarks = key => {
    try {
      const stored = JSON.parse(page.localStorage.getItem(bookmarkStorageKey(key)) || '[]');
      const entries = Array.isArray(stored)
        ? stored.filter(id => Number.isSafeInteger(id) && id >= 0).map(id => [id, ''])
        : Object.entries(stored ?? {}).flatMap(([rawId, title]) => {
            const id = Number(rawId);
            return Number.isSafeInteger(id) && id >= 0 ? [[id, typeof title === 'string' ? title : '']] : [];
          });
      bookmarkedIds = new Map(entries);
    } catch (_) {
      bookmarkedIds = new Map();
    }
  };
  const saveBookmarks = () => {
    try {
      page.localStorage.setItem(bookmarkStorageKey(identity), JSON.stringify(Object.fromEntries(bookmarkedIds)));
    } catch (_) {
      /* 存储不可用时，收藏仍在当前页面会话内有效 */
    }
  };
  const isBookmarked = id => bookmarkedIds.has(id);
  const getBookmarkTitle = id => bookmarkedIds.get(id) ?? '';
  const findNeighborId = (from, delta) => {
    for (let id = from + delta; id >= 0 && id <= lastId(); id += delta)
      if (!reader.skipBookmarks.checked || !isBookmarked(id)) return id;
    return null;
  };
  const floorId = el => Number(el.getAttribute('mesid'));
  const floorElement = id => chat?.querySelector(`.mes[mesid="${id}"]`);
  const readerDocument = () => {
    try {
      return reader.frame.contentDocument;
    } catch (_) {
      return null;
    }
  };
  let continueReading = false;
  const autoReader = createAutoReader({
    page,
    target: () => {
      if (disposed || archiveMode || !ui.panel.hidden) return null;
      return readerState ? readerDocument()?.scrollingElement as HTMLElement ?? null : chat;
    },
    onEnd: async () => {
      if (!continueReading || !readerState || archiveMode || busy || disposed) return false;
      const nextId = findNeighborId(readerState.id, 1);
      if (nextId === null) return false;
      return new Promise<boolean>(resolve => {
        const finish = (ok: boolean) => {
          page.clearTimeout(timeout);
          reader.frame.removeEventListener('load', loaded);
          resolve(ok && !disposed && readerState?.id === nextId);
        };
        const loaded = () => page.setTimeout(() => finish(true), 0);
        const timeout = page.setTimeout(() => finish(false), 5000);
        reader.frame.addEventListener('load', loaded);
        goTo(nextId, generation, true, 0, { focus: false }).catch(() => finish(false));
      });
    },
    onChange: (running, speed) => {
      shadow.querySelectorAll<HTMLButtonElement>('.auto-toggle').forEach(button => {
        button.textContent = running ? '暂停阅读' : '自动阅读';
        button.setAttribute('aria-pressed', String(running));
      });
      shadow.querySelectorAll<HTMLSelectElement>('.auto-speed').forEach(select => select.value = String(speed));
      $('.auto-float').hidden = !running || !reader.panel.hidden;
    },
  });
  const hideReader = () => {
    autoReader.pause();
    messageRenderer.unmountDocuments();
    readerState = null;
    archiveMode = false;
    readerLoad++;
    reader.panel.hidden = reader.mask.hidden = true;
    reader.frame.removeAttribute('srcdoc');
    ui.wrap.classList.remove('compact');
  };
  const currentFloor = () => findCurrentFloor(page, doc, chat, messages);
  const contentTop = el => (chat ? getContentTop(chat, el) : 0);
  const showStatus = message => {
    ui.status.textContent = message;
    if (ui.panel.hidden) {
      ui.toast.textContent = message;
      ui.toast.hidden = false;
      page.clearTimeout(toastTimer);
      toastTimer = page.setTimeout(() => {
        ui.toast.hidden = true;
      }, 3500);
    }
  };
  const lastId = () => {
    const ctx = context();
    if (Array.isArray(ctx?.chat)) return ctx.chat.length - 1;
    try {
      if (typeof getLastMessageId === 'function') return getLastMessageId();
    } catch (_) {
      /* 暂无聊天 */
    }
    return messages.reduce((max, el) => Math.max(max, floorId(el)), -1);
  };
  const updateMessageBookmarkButton = (button, id) => {
    const saved = isBookmarked(id);
    button.classList.toggle('fa-solid', saved);
    button.classList.toggle('fa-regular', !saved);
    button.classList.toggle('meow-bookmarked', saved);
    button.style.color = saved ? 'var(--SmartThemeQuoteColor, #d8a13b)' : '';
    button.title = saved ? '取消收藏' : '收藏此楼';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(saved));
  };
  const syncMessageBookmarkButton = message => {
    const menu = message?.querySelector('.extraMesButtons');
    const id = Number(message?.getAttribute('mesid'));
    if (!menu || !Number.isSafeInteger(id) || id < 0) return;
    let button = menu.querySelector('.meow-message-bookmark-action');
    if (!button) {
      button = doc.createElement('div');
      button.className = 'mes_button meow-message-bookmark-action fa-regular fa-bookmark';
      button.setAttribute('role', 'button');
      button.setAttribute('tabindex', '0');
      menu.prepend(button);
    }
    updateMessageBookmarkButton(button, id);
  };
  const syncMessageBookmarkButtons = (root = chat) => {
    if (!root) return;
    if (root.matches?.('.mes[mesid]')) syncMessageBookmarkButton(root);
    root.querySelectorAll('.mes[mesid]').forEach(syncMessageBookmarkButton);
  };
  const update = () => {
    if (disposed) return;
    const ctx = context(),
      nextKey = chatKey(ctx);
    if (nextKey !== identity) {
      identity = nextKey;
      loadBookmarks(identity);
      syncMessageBookmarkButtons();
      history = [];
      generation++;
      messageAccess.clear();
      renderCache.clear();
      archiveRows = [];
      ui.status.textContent = '';
      hideReader();
    }
    const el = readerState ? null : currentFloor(),
      id = readerState ? readerState.id : el ? floorId(el) : null,
      last = lastId();
    observedLast = last;
    const setText = (el, value) => {
      if (el.textContent !== value) el.textContent = value;
    };
    setText(ui.floor, id === null ? '—' : `${id} 楼`);
    setText(
      ui.location,
      last < 0 ? '暂无聊天' : `${readerState ? '正在阅读' : '当前'} ${id === null ? '—' : id} 楼 · 共 ${last + 1} 层`,
    );
    ui.up.disabled =
      ui.down.disabled =
      ui.panelUp.disabled =
      ui.panelDown.disabled =
        busy || archiveMode || !(el || readerState);
    ui.go.disabled = busy || last < 0;
    ui.view.disabled = ui.swipes.disabled = busy || last < 0;
    ui.viewBookmarks.disabled = busy || last < 0;
    ui.back.disabled = ui.return.disabled = busy || !history.length;
    setText(ui.return.querySelector('span'), history.length ? `返回 ${history.at(-1).id} 楼` : '返回');
    if (ui.panel.getAttribute('aria-busy') !== String(busy)) ui.panel.setAttribute('aria-busy', String(busy));
    reader.previous.disabled = busy || archiveMode || !readerState || findNeighborId(readerState.id, -1) === null;
    reader.next.disabled = busy || archiveMode || !readerState || findNeighborId(readerState.id, 1) === null;
    reader.bookmark.disabled = busy || archiveMode || !readerState;
    reader.bookmark.setAttribute('aria-pressed', String(!!readerState && isBookmarked(readerState.id)));
    reader.bookmark.textContent = readerState && isBookmarked(readerState.id) ? '★ 已收藏' : '☆ 收藏';
    reader.bookmarkTitle.disabled = busy || archiveMode || !readerState;
    reader.bookmarks.disabled = busy || archiveMode || !readerState;
    const titleFloor = readerState?.id ?? null;
    if (titleFloor !== bookmarkTitleFloor) {
      bookmarkTitleFloor = titleFloor;
      reader.bookmarkTitle.value = titleFloor === null ? '' : getBookmarkTitle(titleFloor);
    } else if (readerState && shadow.activeElement !== reader.bookmarkTitle) {
      const savedTitle = isBookmarked(readerState.id) ? getBookmarkTitle(readerState.id) : '';
      if (reader.bookmarkTitle.value !== savedTitle) reader.bookmarkTitle.value = savedTitle;
    }
    updateSwipeControls();
  };
  const schedule = () => {
    if (!frame && !disposed)
      frame = page.requestAnimationFrame(() => {
        frame = 0;
        if (scanPending) {
          scanPending = false;
          messages = chat
            ? [...chat.querySelectorAll('.mes[mesid]')].filter(el => /^\d+$/.test(el.getAttribute('mesid')))
            : [];
        }
        update();
      });
  };
  const scan = () => {
    syncMessageBookmarkButton(floorElement(lastId()));
    scanPending = true;
    schedule();
  };
  const snapshot = () => {
    if (readerState)
      return {
        id: readerState.id,
        mode: 'reader',
        swipeId: readerState.swipeId,
        raw: readerState.raw,
        offset: readerDocument()?.scrollingElement?.scrollTop ?? 0,
        message: context()?.chat?.[readerState.id],
        key: identity,
      };
    const el = currentFloor();
    if (!el) return null;
    const id = floorId(el);
    return { id, mode: 'chat', offset: chat.scrollTop - contentTop(el), message: context()?.chat?.[id], key: identity };
  };
  const saveHistory = entry => {
    if (entry) {
      history.push(entry);
      if (history.length > 30) history.shift();
    }
  };
  const closePanel = (focus = false) => {
    ui.panel.hidden = true;
    ui.wrap.classList.add('shelved');
    ui.wrap.classList.remove('panel-open');
    ui.wrap.classList.remove('rail-expanded');
    reader.panel.inert = false;
    ui.rail.inert = viewportBounds(page).width <= 600;
    ui.dockHandle.inert = !reader.panel.hidden;
    ui.dockHandle.setAttribute('aria-expanded', 'false');
    ui.dockHandle.setAttribute('aria-label', '展开侧边按钮');
    ui.dockHandle.title = '展开侧边按钮';
    ui.bird.setAttribute('aria-expanded', 'false');
    requestPlace();
    if (focus) {
      if (viewportBounds(page).width <= 600) ui.dockHandle.focus({ preventScroll: true });
      else ui.bird.focus({ preventScroll: true });
    }
  };
  const togglePanel = () => {
    autoReader.pause();
    if (!ui.panel.hidden) {
      closePanel(true);
      return;
    }
    ui.panel.hidden = false;
    ui.wrap.classList.remove('shelved');
    ui.wrap.classList.add('panel-open');
    ui.wrap.classList.remove('rail-expanded');
    reader.panel.inert = true;
    ui.rail.inert = true;
    ui.dockHandle.inert = true;
    reader.settings.open = false;
    ui.toast.hidden = true;
    ui.status.textContent = '';
    ui.bird.setAttribute('aria-expanded', 'true');
    update();
    place();
    if (viewportBounds(page).width > 600) {
      ui.input.focus({ preventScroll: true });
      ui.input.select();
    } else ui.panel.focus({ preventScroll: true });
  };
  function requestPlace() {
    if (!layoutFrame && !disposed)
      layoutFrame = page.requestAnimationFrame(() => {
        layoutFrame = 0;
        place();
      });
  }
  function place() {
    const bounds = viewportBounds(page);
    const mobile = bounds.width <= 600;
    const compact = !!(readerState || archiveMode) && mobile;
    ui.wrap.classList.toggle('mobile', mobile);
    if (!mobile) ui.wrap.classList.remove('rail-expanded');
    const overlayOpen = !ui.panel.hidden || !reader.panel.hidden;
    ui.wrap.classList.toggle('panel-open', overlayOpen);
    const railExpanded = mobile && ui.wrap.classList.contains('rail-expanded') && !overlayOpen;
    ui.rail.inert = (mobile && !railExpanded) || overlayOpen;
    ui.dockHandle.hidden = !mobile;
    ui.dockHandle.inert = !mobile || overlayOpen;
    ui.dockHandle.setAttribute('aria-expanded', String(railExpanded));
    ui.dockHandle.setAttribute('aria-label', railExpanded ? '收起侧边按钮' : '展开侧边按钮');
    ui.dockHandle.title = railExpanded ? '收起侧边按钮' : '展开侧边按钮';
    ui.wrap.classList.toggle('shelved', ui.panel.hidden);
    ui.wrap.classList.toggle('compact', compact);
    ui.wrap.classList.toggle('short', bounds.height < 450);
    const height = $('.rail').offsetHeight;
    const width = bounds.width,
      winHeight = bounds.height;
    const x = Number.isFinite(position?.x) ? position.x * width : width - 74;
    const y = Number.isFinite(position?.y) ? position.y * winHeight : winHeight * 0.42;
    const dockWidth = 48;
    const left = bounds.x + (mobile ? width - dockWidth : Math.max(8, Math.min(width - 66, x)));
    const top = bounds.y + Math.max(8, Math.min(Math.max(8, winHeight - height - 12), y));
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    host.style.right = 'auto';
    const onLeft = left - bounds.x < width / 2;
    ui.wrap.classList.toggle('left', onLeft);
    $('.bottom').hidden = mobile;
    if (mobile) {
      ui.panel.style.left = `${bounds.x}px`;
      ui.panel.style.top = `${bounds.y}px`;
      ui.panel.style.width = `${width}px`;
      ui.panel.style.height = `${winHeight}px`;
      ui.panel.style.maxHeight = 'none';
    } else {
      const panelWidth = Math.min(360, width - 32);
      ui.panel.style.width = `${panelWidth}px`;
      ui.panel.style.height = 'auto';
      ui.panel.style.maxHeight = `${winHeight - 32}px`;
      const panelLeft = onLeft ? left + 70 : left - panelWidth - 12;
      ui.panel.style.left = `${Math.max(bounds.x + 16, Math.min(bounds.x + width - panelWidth - 16, panelLeft))}px`;
      ui.panel.style.top = `${Math.max(bounds.y + 16, Math.min(top, bounds.y + winHeight - ui.panel.offsetHeight - 16))}px`;
    }
    const toastWidth = ui.toast.offsetWidth || 220;
    ui.toast.style.left = `${Math.max(8, Math.min(width - toastWidth - 8, onLeft ? left + 70 : left - toastWidth - 12)) - left}px`;
    ui.toast.style.right = 'auto';
    ui.side.textContent = onLeft ? '移到右侧' : '移到左侧';
    if (readerState || archiveMode) {
      const readerWidth = mobile ? width : Math.min(1040, width - 64);
      const readerHeight = mobile ? winHeight : Math.min(900, winHeight - 64);
      reader.panel.style.left = `${bounds.x + (width - readerWidth) / 2}px`;
      reader.panel.style.top = `${bounds.y + (winHeight - readerHeight) / 2}px`;
      reader.panel.style.width = `${readerWidth}px`;
      reader.panel.style.height = `${readerHeight}px`;
      const inside = readerDocument();
      const actions = $('.reader-actions');
      $('.reader-options').style.setProperty(
        '--settings-room',
        `${Math.max(44, reader.panel.clientHeight - actions.offsetTop - actions.offsetHeight - 14)}px`,
      );
    }
  }
  const persistPosition = () => {
    const r = host.getBoundingClientRect();
    const bounds = viewportBounds(page);
    position = { x: (r.left - bounds.x) / bounds.width, y: (r.top - bounds.y) / bounds.height };
    try {
      page.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
    } catch (_) {
      /* 非必要设置 */
    }
  };
  const scrollTo = top => {
    // 即时定位避免长距离动画经过很多楼层，也避免“返回”保存动画中途的位置。
    if (typeof page.jQuery === 'function') page.jQuery(chat).stop(true);
    chat.scrollTo({ top: Math.max(0, Math.min(chat.scrollHeight - chat.clientHeight, top)), behavior: 'instant' });
    schedule();
  };
  const flash = el => {
    clearHighlight();
    const value = el.style.getPropertyValue('outline'),
      priority = el.style.getPropertyPriority('outline');
    el.style.setProperty('outline', '2px solid #83b3a2', 'important');
    highlighted = { el, value, priority };
    highlightTimer = page.setTimeout(clearHighlight, 1100);
  };
  function clearHighlight() {
    if (highlighted) {
      const { el, value, priority } = highlighted;
      if (value) el.style.setProperty('outline', value, priority);
      else el.style.removeProperty('outline');
      highlighted = null;
    }
    page.clearTimeout(highlightTimer);
  }
  const messageAccess = createMessageAccess({ page, context, lastId });
  const { readMessage, nearestAssistant } = messageAccess;
  function updateSwipeControls() {
    if (!readerState) return;
    const { message, swipeId } = readerState;
    reader.swipePrevious.disabled = busy || swipeId <= 0;
    reader.swipeNext.disabled = busy || swipeId >= message.swipes.length - 1;
    reader.swipeCurrent.disabled = busy;
    reader.raw.disabled = reader.refresh.disabled = busy;
    const state =
      (generating ? ' · 生成中' : '') + (message.cached ? ' · 缓存' : swipeId === message.swipe_id ? ' · 已选' : '');
    const count = `${swipeId + 1} / ${message.swipes.length}${state}`;
    if (reader.swipeCount.textContent !== count) reader.swipeCount.textContent = count;
    reader.raw.setAttribute('aria-pressed', String(readerState.raw));
    reader.raw.textContent = readerState.raw ? '预览' : '原文';
  }
  const messageRenderer = createMessageRenderer({ page, doc, host, reader, context, lastId });
  const renderReaderContent = (id, message) => messageRenderer.renderContent(id, message);
  const extractBody = text => messageRenderer.extractBody(text);
  applyTheme();
  const showReader = (id, message, offset = 0, options = {}) => {
    const swipeId = Math.max(
      0,
      Math.min(
        message.swipes.length - 1,
        options.swipeId ?? (readerState?.id === id ? readerState.swipeId : message.swipe_id),
      ),
    );
    const raw = options.raw ?? (readerState?.id === id ? readerState.raw : false);
    const text = message.swipes[swipeId] ?? '';
    const pipeline = messageRenderer.pipeline();
    if (pipeline.some((fn, index) => fn !== renderPipeline[index])) {
      renderCache.clear();
      renderPipeline = pipeline;
    }
    const cacheKey = JSON.stringify([
      id,
      swipeId,
      raw,
      message.name,
      message.is_user,
      message.is_system,
      message.extra?.type,
      reader.ignoreDepth.checked,
      reader.bodyOnly.checked,
      reader.start.value,
      reader.end.value,
      reader.ignoreDepth.checked ? 0 : lastId(),
    ]);
    const cached = renderCache.get(cacheKey);
    let bodyHtml;
    if (cached?.text === text) {
      bodyHtml = cached.html;
      renderCache.delete(cacheKey);
      renderCache.set(cacheKey, cached);
    } else {
      let template;
      if (raw) {
        template = doc.createElement('template');
        const pre = doc.createElement('pre');
        pre.textContent = text || '（此回复暂为空）';
        template.content.appendChild(pre);
      } else template = renderReaderContent(id, { ...message, mes: extractBody(text) || '（此回复暂为空）' });
      messageRenderer.sanitizeContent(template.content);
      messageRenderer.prepareDocuments(template.content);
      bodyHtml = template.innerHTML;
      renderCache.set(cacheKey, { text, html: bodyHtml });
      // 限制条目和总字符数，避免多次翻阅长期占用内存。
      let size = [...renderCache.values()].reduce((sum, value) => sum + value.text.length + value.html.length, 0);
      while (renderCache.size > 6 || size > 2000000) {
        const key = renderCache.keys().next().value,
          value = renderCache.get(key);
        size -= value.text.length + value.html.length;
        renderCache.delete(key);
      }
    }
    const body = doc.createElement('body');
    body.classList.add('mes_text');
    body.innerHTML = bodyHtml;
    const wrapperStyle = doc.createElement('style');
    wrapperStyle.textContent = 'content,meow_fm,snow{display:block}';
    body.prepend(wrapperStyle);
    messageRenderer.unmountDocuments();
    const load = ++readerLoad;
    readerState = { id, message, swipeId, raw, text };
    archiveMode = false;
    archive.panel.hidden = true;
    reader.frame.hidden = false;
    $('.reader-swipes').hidden = $('.reader-actions').hidden = false;
    $('.reader-auto').hidden = false;
    reader.panel.hidden = reader.mask.hidden = false;
    reader.title.textContent = `第 ${id} 楼${message.name ? ` · ${message.name}` : ''}`;
    reader.frame.onload = () => {
      if (disposed || load !== readerLoad || !readerState) return;
      const inside = readerDocument();
      if (!inside) return;
      inside.documentElement.dataset.theme = host.dataset.theme;
      messageRenderer.mountDocuments(inside, {
        onInteraction: () => {
          reader.settings.open = false;
          autoReader.pause();
        },
        onEscape: () => {
          if (reader.settings.open) closeSettings();
          else exitReader();
        },
      });
      inside.scrollingElement.scrollTop = offset;
      inside.addEventListener('pointerdown', autoReader.pause, { passive: true });
      inside.addEventListener('wheel', autoReader.pause, { passive: true });
      inside.addEventListener('keydown', event => {
        if ([' ', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) autoReader.pause();
      });
      // 在阅读窗口内点击链接不会替换消息，避免丢失返回锚点。
      inside.addEventListener('click', event => {
        reader.settings.open = false;
        if (event.composedPath().some(el => el.tagName === 'A')) event.preventDefault();
      });
      inside.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (reader.settings.open) closeSettings();
          else exitReader();
        }
      });
    };
    reader.frame.srcdoc = `<!doctype html><html data-theme="${host.dataset.theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data: blob:; style-src 'unsafe-inline' https: http:; font-src https: http: data:; script-src 'unsafe-inline' https: http: blob:; frame-src 'self' about: data: blob:; form-action 'none'; base-uri 'none'"><style>:root{--bg:#fff;--text:#263e59;--link:#386aab;--border:#c5d4e6;color-scheme:light}:root[data-theme="dark"]{--bg:#181b20;--text:#e4e7eb;--link:#b5c7df;--border:#464d58;color-scheme:dark}body{margin:0 auto;max-width:1100px;padding:20px;color:var(--text);background:var(--bg);font:16px/1.85 system-ui,-apple-system,'Microsoft YaHei',sans-serif;overflow-wrap:anywhere}img,svg,video{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}table{max-width:100%;display:block;overflow:auto}a{color:var(--link)}blockquote{margin:12px 0;padding-left:16px;border-left:3px solid var(--border)}*{box-sizing:border-box}@media(max-width:1199px){body{padding:20px}}@media(max-width:600px){body{padding:14px 16px;line-height:1.8}}</style></head>${body.outerHTML}</html>`;
    closePanel();
    ui.toast.hidden = true;
    if (options.focus !== false) reader.panel.focus({ preventScroll: true });
    schedule();
  };
  const goTo = async (id, token, preferReader = false, offset = 0, options = {}) => {
    if (disposed || token !== generation) throw new Error('聊天已切换，本次跳转已取消。');
    let el = !preferReader && floorElement(id);
    // 只有明确开启原生虚拟聊天的 TauriTavern 才允许宿主跳转，普通酒馆不批量加载。
    const virtual = page.__TAURITAVERN__?.api?.chatSurface?.isManagedOwnershipRequired?.() === true;
    if (!el && !preferReader && virtual) {
      const helper = page.TavernHelper;
      const jump = typeof triggerSlash === 'function' ? triggerSlash : helper?.triggerSlash?.bind(helper);
      if (jump) {
        await jump(`/chat-jump ${id}`);
        el = floorElement(id);
      }
    }
    if (disposed || token !== generation) throw new Error('聊天已切换，本次跳转已取消。');
    if (el) {
      if (!el.getClientRects().length || el.getBoundingClientRect().height <= 0)
        throw new Error(`${id} 楼当前被隐藏，请先在酒馆中显示该楼层。`);
      hideReader();
      closePanel(true);
      scrollTo(contentTop(el) + offset);
      flash(el);
      return;
    }
    showReader(id, readMessage(id), preferReader ? offset : 0, options);
  };
  const runNavigation = async action => {
    if (busy || disposed) return;
    update();
    const token = generation;
    busy = true;
    update();
    try {
      await action(token);
    } catch (error) {
      if (!disposed) showStatus(error.message || '跳转失败，请重试。');
    } finally {
      busy = false;
      if (!disposed) {
        schedule();
        update();
        place();
      }
    }
  };
  const go = () =>
    runNavigation(async token => {
      const raw = ui.input.value.trim().replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
      const match = /^(?:第\s*)?(\d+)\s*(?:楼|层)?$/.exec(raw);
      const id = match ? Number(match[1]) : NaN;
      if (!Number.isSafeInteger(id) || id < 0 || id > lastId()) {
        ui.input.setAttribute('aria-invalid', 'true');
        showStatus(`请输入 0～${Math.max(0, lastId())} 之间的楼层号。`);
        ui.input.focus({ preventScroll: true });
        return;
      }
      ui.input.removeAttribute('aria-invalid');
      const before = snapshot();
      showStatus(`正在前往 ${id} 楼…`);
      await goTo(id, token);
      if (disposed || token !== generation) return;
      saveHistory(before);
      showStatus(`已到 ${id} 楼`);
    });
  const back = () =>
    runNavigation(async token => {
      const entry = history.at(-1);
      if (!entry || entry.key !== identity) return;
      let id = entry.id;
      if (entry.message) {
        id = context()?.chat?.indexOf(entry.message) ?? -1;
        if (id < 0) {
          history.pop();
          throw new Error('原来的楼层已被删除，无法恢复该位置。');
        }
      }
      showStatus(`正在返回 ${id} 楼…`);
      await goTo(id, token, entry.mode === 'reader', entry.offset, { swipeId: entry.swipeId, raw: entry.raw });
      if (disposed || token !== generation) return;
      history.pop();
    });
  const edge = bottom => {
    if (busy) return;
    update();
    if (readerState) {
      const scrolling = readerDocument()?.scrollingElement;
      if (!scrolling) return;
      const target = bottom ? Math.max(0, scrolling.scrollHeight - scrolling.clientHeight) : 0;
      if (Math.abs(scrolling.scrollTop - target) < 2) return;
      saveHistory(snapshot());
      scrolling.scrollTop = target;
      update();
      return;
    }
    const el = currentFloor();
    if (!el) {
      showStatus('请先打开一个聊天。');
      return;
    }
    const before = snapshot();
    const top = contentTop(el) + (bottom ? Math.max(0, el.getBoundingClientRect().height - chat.clientHeight) : 0);
    if (Math.abs(chat.scrollTop - Math.max(0, Math.min(chat.scrollHeight - chat.clientHeight, top))) < 2) return;
    saveHistory(before);
    scrollTo(top);
    update();
  };
  listen(ui.bird, 'click', () => {
    togglePanel();
  });
  listen(ui.dockHandle, 'click', () => {
    if (!ui.panel.hidden) return;
    const expanded = !ui.wrap.classList.contains('rail-expanded');
    ui.wrap.classList.toggle('rail-expanded', expanded);
    ui.rail.inert = !expanded;
    ui.dockHandle.setAttribute('aria-expanded', String(expanded));
    ui.dockHandle.setAttribute('aria-label', expanded ? '收起侧边按钮' : '展开侧边按钮');
    ui.dockHandle.title = expanded ? '收起侧边按钮' : '展开侧边按钮';
  });
  listen(ui.up, 'click', () => edge(false));
  listen(ui.down, 'click', () => edge(true));
  listen(ui.panelUp, 'click', () => {
    closePanel(true);
    edge(false);
  });
  listen(ui.panelDown, 'click', () => {
    closePanel(true);
    edge(true);
  });
  listen(ui.back, 'click', back);
  listen(ui.return, 'click', back);
  const readerNeighbor = delta =>
    runNavigation(async token => {
      if (!readerState) return;
      const before = snapshot(), id = findNeighborId(readerState.id, delta);
      if (id === null) return;
      await goTo(id, token, true);
      saveHistory(before);
    });
  const exitReader = () => {
    if (busy) return;
    while (history.at(-1)?.mode === 'reader') history.pop();
    if (history.length) back();
    else {
      hideReader();
      update();
      place();
    }
    ui.bird.focus({ preventScroll: true });
  };
  listen(reader.previous, 'click', () => readerNeighbor(-1));
  listen(reader.next, 'click', () => readerNeighbor(1));
  listen(reader.exit, 'click', exitReader);
  listen(reader.mask, 'click', exitReader);
  const changeReaderSettings = () =>
    runNavigation(async token => {
      if (readerState && !archiveMode)
        await goTo(readerState.id, token, true, readerDocument()?.scrollingElement?.scrollTop ?? 0);
    });
  for (const field of [reader.ignoreDepth, reader.bodyOnly, reader.skipBookmarks, reader.start, reader.end])
    listen(field, 'change', changeReaderSettings);
  listen(reader.bookmark, 'click', () => {
    if (!readerState || archiveMode) return;
    const id = readerState.id;
    if (isBookmarked(id)) bookmarkedIds.delete(id);
    else bookmarkedIds.set(id, reader.bookmarkTitle.value.trim());
    saveBookmarks();
    syncMessageBookmarkButton(floorElement(id));
    update();
  });
  listen(reader.bookmarkTitle, 'input', () => {
    if (!readerState || !isBookmarked(readerState.id)) return;
    bookmarkedIds.set(readerState.id, reader.bookmarkTitle.value.trim());
    saveBookmarks();
  });
  listen(doc, 'click', event => {
    const action = event.target?.closest?.('.meow-message-bookmark-action');
    if (!action || !chat?.contains(action)) return;
    event.preventDefault();
    event.stopPropagation();
    const message = action.closest('.mes[mesid]');
    const id = Number(message?.getAttribute('mesid'));
    if (!Number.isSafeInteger(id) || id < 0) return;
    if (isBookmarked(id)) bookmarkedIds.delete(id);
    else bookmarkedIds.set(id, '');
    saveBookmarks();
    updateMessageBookmarkButton(action, id);
    update();
    showStatus(isBookmarked(id) ? `已收藏第 ${id} 楼，可在喵喵助手的收藏夹中添加备注。` : `已取消第 ${id} 楼的收藏。`);
  });
  listen(doc, 'keydown', event => {
    const action = event.target?.closest?.('.meow-message-bookmark-action');
    if (!action || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    action.click();
  });
  const chooseSwipe = value =>
    runNavigation(async token => {
      if (!readerState || archiveMode) return;
      const before = snapshot();
      await goTo(readerState.id, token, true, 0, { swipeId: value, raw: readerState.raw });
      saveHistory(before);
    });
  listen(reader.swipePrevious, 'click', () => chooseSwipe(readerState.swipeId - 1));
  listen(reader.swipeNext, 'click', () => chooseSwipe(readerState.swipeId + 1));
  listen(reader.swipeCurrent, 'click', () => chooseSwipe(readMessage(readerState.id).swipe_id));
  listen(reader.raw, 'click', () =>
    runNavigation(async token => {
      if (readerState) await goTo(readerState.id, token, true, 0, { raw: !readerState.raw });
    }),
  );
  const refreshReader = () => {
    if (busy || disposed || !readerState || archiveMode) return;
    try {
      const message = readMessage(readerState.id);
      const swipeId = Math.min(readerState.swipeId, message.swipes.length - 1);
      if (message.swipes[swipeId] !== readerState.text)
        showReader(readerState.id, message, readerDocument()?.scrollingElement?.scrollTop ?? 0, {
          swipeId,
          focus: false,
        });
      else {
        readerState.message = message;
        updateSwipeControls();
      }
    } catch (error) {
      showStatus(error.message);
    }
  };
  const scheduleRefresh = () => {
    if (refreshTimer || disposed) return;
    refreshTimer = page.setTimeout(
      () => {
        refreshTimer = 0;
        refreshReader();
      },
      generating ? 400 : 120,
    );
  };
  listen(reader.refresh, 'click', () =>
    runNavigation(async token => {
      if (!readerState || archiveMode) return;
      renderCache.clear();
      await goTo(readerState.id, token, true, readerDocument()?.scrollingElement?.scrollTop ?? 0, { focus: false });
    }),
  );
  const openMessage = (previous = false, latest = false) =>
    runNavigation(async token => {
      const visible = readerState?.id ?? (currentFloor() ? floorId(currentFloor()) : lastId());
      const id = previous || latest ? nearestAssistant(generating || latest ? lastId() : visible) : visible;
      if (id === null || id < 0) throw new Error('当前没有可查看的消息。');
      const before = snapshot(),
        message = readMessage(id);
      const options = previous ? { swipeId: Math.max(0, message.swipe_id - 1), raw: false } : { raw: false };
      await goTo(id, token, true, 0, options);
      saveHistory(before);
    });
  listen(ui.view, 'click', () => openMessage());
  listen(ui.swipes, 'click', () => openMessage(true));
  listen(reader.latest, 'click', () => openMessage(false, true));
  const renderArchive = () => {
    const result = collectionMode === 'bookmarks'
      ? renderBookmarkPage(doc, archive, bookmarkRows, archivePage, archive.search.value)
      : renderArchivePage(
          doc,
          archive,
          archiveRows,
          archivePage,
          archive.search.value,
          archive.hideBookmarks.checked,
          isBookmarked,
        );
    archivePage = result.page;
  };
  const openCollection = mode => {
    if (busy) return;
    autoReader.pause();
    $('.reader-auto').hidden = true;
    update();
    collectionMode = mode;
    if (mode === 'bookmarks') {
      bookmarkRows = [...bookmarkedIds.entries()].sort(([a], [b]) => a - b).map(([id, title]) => {
        try {
          const message = readMessage(id);
          const text = String(message.swipes?.[message.swipe_id] ?? message.mes ?? '');
          return {
            id,
            title,
            role: message.is_user ? '用户' : message.is_system || message.extra?.type === 'narrator' ? '系统' : '助手',
            preview: messagePreview(text),
          };
        } catch (_) {
          return { id, title, role: '消息暂不可读', preview: '' };
        }
      });
      archive.hideBookmarks.closest('label').hidden = true;
      archive.search.placeholder = '搜索备注标题、楼层或内容';
    } else {
      archiveRows = collectArchiveRows(context()?.chat, page, lastId());
      archive.hideBookmarks.closest('label').hidden = false;
      archive.search.placeholder = '搜索楼层、角色或内容';
    }
    if (!readerState && !archiveMode) saveHistory(snapshot());
    archiveMode = true;
    archivePage = 0;
    archive.search.value = '';
    reader.panel.hidden = reader.mask.hidden = false;
    archive.panel.hidden = false;
    reader.frame.hidden = true;
    $('.reader-swipes').hidden = $('.reader-actions').hidden = true;
    reader.title.textContent = mode === 'bookmarks' ? '收藏夹' : '回复目录';
    closePanel();
    renderArchive();
    update();
    place();
    archive.search.focus({ preventScroll: true });
  };
  const openArchive = () => openCollection('replies');
  const openBookmarks = () => openCollection('bookmarks');
  listen($('.view-archive'), 'click', openArchive);
  listen($('.reader-archive'), 'click', openArchive);
  listen(reader.bookmarks, 'click', openBookmarks);
  listen(ui.viewBookmarks, 'click', openBookmarks);
  listen(archive.search, 'input', () => {
    page.clearTimeout(searchTimer);
    searchTimer = page.setTimeout(() => {
      archivePage = 0;
      renderArchive();
    }, 150);
  });
  listen(archive.hideBookmarks, 'change', () => {
    archivePage = 0;
    renderArchive();
  });
  listen(archive.previous, 'click', () => {
    archivePage--;
    renderArchive();
  });
  listen(archive.next, 'click', () => {
    archivePage++;
    renderArchive();
  });
  listen(archive.list, 'click', event => {
    const card = event.target.closest('.history-card');
    if (!card) return;
    runNavigation(async token => {
      const before = readerState ? snapshot() : null;
      await goTo(Number(card.dataset.floor), token, true, 0, { raw: false });
      saveHistory(before);
    });
  });
  const menu = doc.querySelector('#extensionsMenu');
  if (menu) {
    const item = doc.createElement('div');
    item.id = 'bird-message-history-menu';
    item.className = 'extension_container interactable';
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'list-group-item flex-container flexGap5 interactable';
    button.textContent = '喵喵回复目录';
    item.appendChild(button);
    menu.appendChild(item);
    listen(button, 'click', openArchive);
    cleanups.push(() => item.remove());
  }
  listen($('form'), 'submit', event => {
    event.preventDefault();
    go();
  });
  listen(ui.input, 'input', () => ui.input.removeAttribute('aria-invalid'));
  listen($('.close'), 'click', () => closePanel(true));
  listen(ui.side, 'click', () => {
    position = {
      x: ui.wrap.classList.contains('left') ? 1 : 0,
      y: host.getBoundingClientRect().top / page.innerHeight,
    };
    place();
    persistPosition();
  });
  function closeSettings() {
    reader.settings.open = false;
    reader.settings.querySelector('summary').focus({ preventScroll: true });
  }
  listen(doc, 'pointerdown', event => {
    const path = event.composedPath();
    if (reader.settings.open && !path.includes(reader.settings)) reader.settings.open = false;
    if (!path.includes(host)) {
      if (!ui.panel.hidden) closePanel();
      if (ui.wrap.classList.contains('rail-expanded')) {
        ui.wrap.classList.remove('rail-expanded');
        place();
      }
    }
    if (!path.some(el => el instanceof page.Element && (el.classList.contains('auto-controls') || el.classList.contains('auto-float')))) autoReader.pause();
  }, { capture: true, passive: true });
  listen(doc, 'wheel', autoReader.pause, { passive: true });
  listen(doc, 'visibilitychange', () => { if (doc.hidden) autoReader.pause(); });
  listen(page, 'blur', () => {
    autoReader.pause();
    page.setTimeout(() => {
      if (doc.activeElement?.tagName === 'IFRAME' && !host.contains(doc.activeElement)) {
        ui.wrap.classList.remove('rail-expanded');
        requestPlace();
      }
    }, 0);
  });
  shadow.querySelectorAll('.auto-toggle').forEach(button => listen(button, 'click', () => {
    if (autoReader.running) { autoReader.pause(); return; }
    if (archiveMode) return;
    closePanel();
    autoReader.start();
  }));
  shadow.querySelectorAll('.auto-speed').forEach(select => {
    (select as HTMLSelectElement).value = String(autoReader.speed);
    listen(select, 'change', () => autoReader.setSpeed(Number((select as HTMLSelectElement).value)));
  });
  shadow.querySelectorAll('.auto-continue').forEach(input => listen(input, 'change', () => {
    continueReading = (input as HTMLInputElement).checked;
    shadow.querySelectorAll<HTMLInputElement>('.auto-continue').forEach(other => other.checked = continueReading);
  }));
  listen($('.auto-float'), 'click', autoReader.pause);
  listen(doc, 'keydown', event => {
    if (event.key === 'Escape' || ([' ', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key) &&
      !event.composedPath().some(el => el instanceof page.Element && el.classList.contains('auto-controls')))) autoReader.pause();
    if (event.key === 'Tab' && !ui.panel.hidden) {
      const controls = [...ui.panel.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(
        el => el.getClientRects().length,
      );
      const first = controls[0],
        last = controls.at(-1),
        active = shadow.activeElement;
      if (
        controls.length &&
        (!ui.panel.contains(active) || active === ui.panel || (event.shiftKey ? active === first : active === last))
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      }
    }
    if (event.key === 'Escape') {
      if (reader.settings.open) {
        event.preventDefault();
        closeSettings();
      } else if (!ui.panel.hidden) {
        event.preventDefault();
        closePanel(true);
      } else if (readerState || archiveMode) {
        event.preventDefault();
        exitReader();
      }
    }
  });
  cleanups.push(bindDockDrag({
    controls: [ui.bird, ui.dockHandle], host,
    enabled: () => !busy && ui.panel.hidden && reader.panel.hidden,
    verticalOnly: () => viewportBounds(page).width <= 600,
    touchHoldMs: control => control === ui.dockHandle && viewportBounds(page).width <= 600 ? 180 : 0,
    onMove: (dx, dy, origin) => {
      const bounds = viewportBounds(page);
      position = { x: (origin.left + dx - bounds.x) / bounds.width, y: (origin.top + dy - bounds.y) / bounds.height };
      requestPlace();
    },
    onEnd: () => { place(); persistPosition(); },
  }));
  listen(page, 'resize', () => {
    requestPlace();
    schedule();
  });
  if (page.visualViewport) {
    listen(page.visualViewport, 'resize', requestPlace);
    listen(page.visualViewport, 'scroll', requestPlace);
  }
  let chatObserver = null;
  const bindChat = () => {
    const next = doc.querySelector('#chat');
    if (next === chat) return;
    if (chat) chat.removeEventListener('scroll', schedule);
    chatObserver?.disconnect();
    chat = next;
    generation++;
    history = [];
    messageAccess.clear();
    renderCache.clear();
    archiveRows = [];
    hideReader();
    if (chat) {
      chat.addEventListener('scroll', schedule, { passive: true });
      chatObserver = new page.MutationObserver(records => {
        for (const record of records)
          for (const node of record.addedNodes)
            if (node.nodeType === 1) syncMessageBookmarkButtons(node);
        scan();
      });
      chatObserver.observe(chat, { childList: true });
    }
    scan();
  };
  // 只检查容器/聊天是否变化，不观察整页和每层内部 DOM，也不闲置扫描全部消息。
  const interval = page.setInterval(() => {
    bindChat();
    if (chatKey(context()) !== identity || lastId() !== observedLast) schedule();
    if (generating && readerState && !archiveMode) scheduleRefresh();
  }, 1000);
  for (const name of ['MESSAGE_RECEIVED', 'MESSAGE_DELETED', 'USER_MESSAGE_RENDERED', 'CHARACTER_MESSAGE_RENDERED']) {
    if (typeof eventOn === 'function' && typeof tavern_events !== 'undefined' && tavern_events[name]) {
      const subscription = eventOn(tavern_events[name], scan);
      cleanups.push(() => subscription.stop());
    }
  }
  if (typeof eventOn === 'function' && typeof tavern_events !== 'undefined') {
    const onChanged = eventOn(tavern_events.CHAT_CHANGED, () => {
      generation++;
      history = [];
      messageAccess.clear();
      renderCache.clear();
      archiveRows = [];
      generating = false;
      ui.status.textContent = '';
      hideReader();
      bindChat();
      scan();
    });
    cleanups.push(() => onChanged.stop());
    if (tavern_events.SETTINGS_UPDATED) {
      const sub = eventOn(tavern_events.SETTINGS_UPDATED, () => renderCache.clear());
      cleanups.push(() => sub.stop());
    }
    for (const name of ['MESSAGE_SWIPED', 'MESSAGE_UPDATED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_SWIPE_DELETED']) {
      if (tavern_events[name]) {
        const sub = eventOn(tavern_events[name], scheduleRefresh);
        cleanups.push(() => sub.stop());
      }
    }
    if (tavern_events.GENERATION_STARTED) {
      const sub = eventOn(tavern_events.GENERATION_STARTED, () => {
        generating = true;
        try {
          const id = nearestAssistant();
          if (id !== null) readMessage(id);
        } catch (_) {
          /* 等待下一次可读快照 */
        }
        updateSwipeControls();
        scheduleRefresh();
      });
      cleanups.push(() => sub.stop());
    }
    for (const name of ['GENERATION_ENDED', 'GENERATION_STOPPED']) {
      if (tavern_events[name]) {
        const sub = eventOn(tavern_events[name], () => {
          generating = false;
          updateSwipeControls();
          scheduleRefresh();
        });
        cleanups.push(() => sub.stop());
      }
    }
  }
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    autoReader.pause();
    generation++;
    reader.frame.onload = null;
    hideReader();
    page.cancelAnimationFrame(frame);
    page.cancelAnimationFrame(layoutFrame);
    page.clearInterval(interval);
    page.clearTimeout(toastTimer);
    page.clearTimeout(refreshTimer);
    page.clearTimeout(searchTimer);
    clearHighlight();
    renderCache.clear();
    messageAccess.clear();
    archiveRows = [];
    chat?.removeEventListener('scroll', schedule);
    chatObserver?.disconnect();
    cleanups.forEach(fn => fn());
    doc.querySelectorAll('.meow-message-bookmark-action').forEach(button => button.remove());
    host.remove();
    if (page[KEY]?.destroy === destroy) delete page[KEY];
  };
  page[KEY] = { destroy };
  listen(window, 'pagehide', destroy, { once: true });
  identity = chatKey(context());
  loadBookmarks(identity);
  bindChat();
  syncMessageBookmarkButtons();
  update();
  place();
}
