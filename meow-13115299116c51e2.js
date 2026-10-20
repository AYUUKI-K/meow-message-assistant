(() => {
  // archive.ts
  function messagePreview(text) {
    return String(text || "").slice(0, 4e3).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
  }
  function collectArchiveRows(chat, page, lastId) {
    const rows = [];
    if (Array.isArray(chat)) {
      chat.forEach((message, id) => {
        if (Array.isArray(message.swipes) && message.swipes.length > 1) {
          rows.push({
            id,
            name: message.name || "",
            role: message.extra?.type === "narrator" ? "系统" : message.is_user ? "用户" : "助手",
            swipes: message.swipes.map((text) => typeof text === "string" ? text : ""),
            current: message.swipe_id || 0
          });
        }
      });
      return rows;
    }
    const helper = page.TavernHelper;
    const get = typeof getChatMessages === "function" ? getChatMessages : helper?.getChatMessages?.bind(helper);
    if (lastId >= 0) {
      for (const message of get?.(`0-${lastId}`, { include_swipes: true }) ?? []) {
        if (message.swipes?.length > 1) {
          rows.push({
            id: message.message_id,
            name: message.name || "",
            role: message.role === "user" ? "用户" : message.role === "system" ? "系统" : "助手",
            swipes: message.swipes,
            current: message.swipe_id || 0
          });
        }
      }
    }
    return rows;
  }
  function renderArchivePage(doc, archive, rows, requestedPage, keyword, hideBookmarked = false, isBookmarked = () => false) {
    const normalized = keyword.trim().toLocaleLowerCase();
    const filtered = rows.filter(
      (row) => (!hideBookmarked || !isBookmarked(row.id)) && (!normalized || `${row.id} ${row.name} ${row.role}`.toLocaleLowerCase().includes(normalized) || row.swipes.some((text) => text.toLocaleLowerCase().includes(normalized)))
    );
    const pages = Math.max(1, Math.ceil(filtered.length / 10));
    const page = Math.max(0, Math.min(pages - 1, requestedPage));
    archive.page.textContent = `${page + 1} / ${pages} · ${filtered.length} 层`;
    archive.previous.disabled = page === 0;
    archive.next.disabled = page >= pages - 1;
    archive.list.replaceChildren();
    for (const row of filtered.slice(page * 10, page * 10 + 10)) {
      const card = doc.createElement("button");
      card.type = "button";
      card.className = "history-card";
      card.dataset.floor = String(row.id);
      const title = doc.createElement("strong");
      title.textContent = `${isBookmarked(row.id) ? "★ " : ""}${row.id} 楼 · ${row.name || row.role}`;
      const meta = doc.createElement("span");
      meta.textContent = `${row.role} · ${row.swipes.length} 个版本`;
      const preview = doc.createElement("p");
      preview.textContent = messagePreview(row.swipes[row.current] || row.swipes[0]);
      card.append(title, meta, preview);
      archive.list.appendChild(card);
    }
    if (!filtered.length) {
      const empty = doc.createElement("p");
      empty.className = "history-empty";
      empty.textContent = rows.length ? "没有匹配的楼层" : "没有多版本回复";
      archive.list.appendChild(empty);
    }
    archive.list.scrollTop = 0;
    return { page, pages };
  }
  function renderBookmarkPage(doc, archive, rows, requestedPage, keyword) {
    const normalized = keyword.trim().toLocaleLowerCase();
    const filtered = rows.filter(
      (row) => !normalized || `${row.id} ${row.title} ${row.role} ${row.preview}`.toLocaleLowerCase().includes(normalized)
    );
    const pages = Math.max(1, Math.ceil(filtered.length / 10));
    const page = Math.max(0, Math.min(pages - 1, requestedPage));
    archive.page.textContent = `${page + 1} / ${pages} · ${filtered.length} 条收藏`;
    archive.previous.disabled = page === 0;
    archive.next.disabled = page >= pages - 1;
    archive.list.replaceChildren();
    for (const row of filtered.slice(page * 10, page * 10 + 10)) {
      const card = doc.createElement("button");
      card.type = "button";
      card.className = "history-card";
      card.dataset.floor = String(row.id);
      const title = doc.createElement("strong");
      title.textContent = row.title || `${row.id} 楼`;
      const meta = doc.createElement("span");
      meta.textContent = `第 ${row.id} 楼 · ${row.role}`;
      const preview = doc.createElement("p");
      preview.textContent = row.preview;
      card.append(title, meta, preview);
      archive.list.appendChild(card);
    }
    if (!filtered.length) {
      const empty = doc.createElement("p");
      empty.className = "history-empty";
      empty.textContent = rows.length ? "没有匹配的收藏" : "还没有收藏消息";
      archive.list.appendChild(empty);
    }
    archive.list.scrollTop = 0;
    return { page, pages };
  }

  // message-access.ts
  function createMessageAccess({ page, context, lastId }) {
    const cache = /* @__PURE__ */ new Map();
    const readMessage = (id) => {
      let message = context()?.chat?.[id];
      const cached = cache.get(id);
      if (!message) {
        const helper = page.TavernHelper;
        const get = typeof getChatMessages === "function" ? getChatMessages : helper?.getChatMessages?.bind(helper);
        let item;
        try {
          item = get?.(id, { include_swipes: true })?.[0];
        } catch (error) {
          if (cached) return { ...cached, cached: true };
          throw error;
        }
        if (item) {
          message = {
            name: item.name,
            mes: item.swipes?.[item.swipe_id] ?? item.message ?? "",
            swipes: item.swipes,
            swipe_id: item.swipe_id,
            is_user: item.role === "user",
            is_system: item.is_hidden,
            extra: item.extra
          };
        }
      }
      if (!message || !message.mes && !message.swipes?.some((text) => typeof text === "string" && text.length)) {
        if (cached) return { ...cached, cached: true };
        if (!message) throw new Error(`无法读取 ${id} 楼的数据。`);
      }
      const swipes = Array.isArray(message.swipes) && message.swipes.length ? message.swipes.map((text) => typeof text === "string" ? text : "") : [message.mes ?? ""];
      const currentSwipeId = Math.max(0, Math.min(swipes.length - 1, Number(message.swipe_id) || 0));
      if (message.mes) swipes[currentSwipeId] = message.mes;
      const result = { ...message, swipes, swipe_id: currentSwipeId, mes: swipes[currentSwipeId], cached: false };
      cache.delete(id);
      cache.set(id, result);
      if (cache.size > 12) cache.delete(cache.keys().next().value);
      return result;
    };
    const nearestAssistant = (limit = lastId()) => {
      const items = context()?.chat;
      if (Array.isArray(items)) {
        for (let id = Math.min(limit, items.length - 1); id >= 0; id--) {
          if (!items[id].is_user && items[id].extra?.type !== "narrator") return id;
        }
      } else {
        const helper = page.TavernHelper;
        const get = typeof getChatMessages === "function" ? getChatMessages : helper?.getChatMessages?.bind(helper);
        const messages = get?.(`0-${Math.max(0, limit)}`, { role: "assistant", include_swipes: true });
        if (messages?.length) return messages.at(-1).message_id;
      }
      return null;
    };
    return { readMessage, nearestAssistant, clear: () => cache.clear() };
  }

  // html-document.ts
  function documentBridge({ token, theme }) {
    const send = (type, extra = {}) => window.parent.postMessage({ type, token, ...extra }, "*");
    const setTheme = (value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.colorScheme = value;
    };
    setTheme(theme);
    for (const name of ["localStorage", "sessionStorage"]) {
      const values = /* @__PURE__ */ new Map();
      const storage = {
        get length() {
          return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(String(key)) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => values.delete(String(key)),
        setItem: (key, value) => values.set(String(key), String(value))
      };
      Object.defineProperty(window, name, { configurable: true, value: storage });
    }
    let pending = false;
    let previousHeight = 0;
    const resize = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        const body = document.body;
        if (!body) return;
        const bounds = body.getBoundingClientRect();
        const style = getComputedStyle(body);
        let contentHeight = bounds.height;
        for (const child of body.children) {
          if (/^(SCRIPT|STYLE|LINK|META)$/.test(child.tagName) || getComputedStyle(child).position === "fixed") continue;
          contentHeight = Math.max(contentHeight, child.getBoundingClientRect().bottom - bounds.top);
        }
        const height = Math.max(
          1,
          Math.ceil(contentHeight + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0))
        );
        if (height !== previousHeight) {
          previousHeight = height;
          send("meow-html-height", { height });
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
        attributes: true
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
    window.addEventListener("load", () => {
      for (const delay of [0, 100, 500]) setTimeout(resize, delay);
    });
    window.addEventListener("resize", resize);
    document.fonts.ready.then(resize);
    document.addEventListener("toggle", resize, true);
    document.addEventListener("transitionend", resize, true);
    document.addEventListener("animationend", resize, true);
    document.addEventListener("submit", (event) => event.preventDefault(), true);
    document.addEventListener("click", (event) => {
      const link = event.target.closest?.("a[href]");
      if (link && !link.getAttribute("href")?.startsWith("#")) event.preventDefault();
      send("meow-html-interaction");
      resize();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setTimeout(() => {
          if (!event.defaultPrevented) send("meow-html-escape");
        }, 0);
      }
    });
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent || event.data?.token !== token || event.data?.type !== "meow-html-theme") return;
      setTheme(event.data.theme === "dark" ? "dark" : "light");
      resize();
    });
  }
  function createHtmlDocumentRenderer({ page, doc, host, preserveLineBreaks }) {
    const frames = /* @__PURE__ */ new Map();
    let stopListening = null;
    const createFragment = (markup) => {
      const container = doc.createElement("div");
      container.className = "bird-html-fragment";
      const storage = doc.createElement("template");
      storage.dataset.birdDocument = "";
      storage.content.appendChild(doc.createTextNode(markup));
      container.appendChild(storage);
      return container.outerHTML;
    };
    const prepareDocuments = (root) => {
      for (const storage of root.querySelectorAll("template[data-bird-document]")) {
        const parsed = new page.DOMParser().parseFromString(storage.content.textContent ?? "", "text/html");
        parsed.querySelectorAll("base,meta[http-equiv]").forEach((element) => element.remove());
        preserveLineBreaks(parsed.body);
        storage.content.replaceChildren(doc.createTextNode("<!doctype html>" + parsed.documentElement.outerHTML));
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
    const syncDocumentTheme = (inside) => {
      for (const [token, frame] of frames) {
        if (frame.ownerDocument === inside)
          frame.contentWindow?.postMessage({ type: "meow-html-theme", token, theme: host.dataset.theme ?? "light" }, "*");
      }
    };
    const mountDocuments = (inside, callbacks = {}) => {
      unmountDocuments();
      const view = inside.defaultView;
      const onMessage = (event) => {
        const data = event.data;
        if (!data || typeof data.token !== "string") return;
        const frame = frames.get(data.token);
        if (!frame || event.source !== frame.contentWindow) return;
        if (data.type === "meow-html-height" && Number.isFinite(data.height)) {
          frame.style.height = `${Math.max(1, Math.min(2e5, Math.ceil(data.height)))}px`;
          frame.dataset.birdReady = "true";
        } else if (data.type === "meow-html-interaction") callbacks.onInteraction?.();
        else if (data.type === "meow-html-escape") callbacks.onEscape?.();
      };
      view.addEventListener("message", onMessage);
      stopListening = () => view.removeEventListener("message", onMessage);
      for (const storage of inside.querySelectorAll("template[data-bird-document]")) {
        const parsed = new page.DOMParser().parseFromString(storage.content.textContent ?? "", "text/html");
        const token = page.crypto.randomUUID();
        const charset = parsed.createElement("meta");
        charset.setAttribute("charset", "utf-8");
        const viewport = parsed.createElement("meta");
        viewport.name = "viewport";
        viewport.content = "width=device-width,initial-scale=1";
        const policy = parsed.createElement("meta");
        policy.httpEquiv = "Content-Security-Policy";
        policy.content = "default-src 'none'; img-src https: http: data: blob:; style-src 'unsafe-inline' https: http:; font-src https: http: data:; script-src 'unsafe-inline' https: http: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
        const style = parsed.createElement("style");
        style.textContent = "html,body{height:auto!important;min-height:0!important}body{margin:0;overflow-wrap:anywhere;font:16px/1.8 system-ui,-apple-system,sans-serif}img,svg,video{max-width:100%;height:auto}content,meow_fm,snow{display:block}";
        const bootstrap = parsed.createElement("script");
        bootstrap.textContent = `(${documentBridge.toString()})(${JSON.stringify({ token, theme: host.dataset.theme ?? "light" })});`;
        parsed.head.prepend(charset, viewport, policy, style, bootstrap);
        const frame = inside.createElement("iframe");
        frame.className = "bird-html-frame";
        frame.title = parsed.title || "消息 HTML 状态栏";
        frame.setAttribute("sandbox", "allow-scripts");
        frame.referrerPolicy = "no-referrer";
        frame.style.cssText = "display:block;width:100%;height:1px;border:0;background:transparent";
        frame.onload = () => syncDocumentTheme(inside);
        frames.set(token, frame);
        storage.replaceWith(frame);
        frame.srcdoc = "<!doctype html>" + parsed.documentElement.outerHTML;
      }
    };
    return { createFragment, prepareDocuments, mountDocuments, unmountDocuments, syncDocumentTheme };
  }

  // message-renderer.ts
  function createMessageRenderer({ page, doc, host, reader, context, lastId }) {
    const displayRegex = () => typeof formatAsTavernRegexedString === "function" ? formatAsTavernRegexedString : page.TavernHelper?.formatAsTavernRegexedString?.bind(page.TavernHelper);
    const messageFormatter = () => typeof formatAsDisplayedMessage === "function" ? formatAsDisplayedMessage : page.TavernHelper?.formatAsDisplayedMessage?.bind(page.TavernHelper);
    const markdownRenderer = () => typeof builtin !== "undefined" ? builtin.renderMarkdown : page.TavernHelper?.builtin?.renderMarkdown;
    const preserveTextLineBreaks = (root) => {
      const blocks = /* @__PURE__ */ new Set([
        "DIV",
        "P",
        "SECTION",
        "ARTICLE",
        "ASIDE",
        "MAIN",
        "HEADER",
        "FOOTER",
        "NAV",
        "DETAILS",
        "SUMMARY",
        "TABLE",
        "THEAD",
        "TBODY",
        "TFOOT",
        "TR",
        "TD",
        "TH",
        "UL",
        "OL",
        "LI",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "BLOCKQUOTE",
        "HR",
        "PRE",
        "FIGURE",
        "FIGCAPTION",
        "CONTENT",
        "MEOW_FM",
        "SNOW"
      ]);
      const inline = (node) => node && (node.nodeType === 3 ? !!node.nodeValue?.trim() : node.nodeType === 1 && node.tagName !== "BR" && !blocks.has(node.tagName));
      const neighbor = (node, direction) => {
        let next = node[direction];
        while (next?.nodeType === 8) next = next[direction];
        return next;
      };
      const walker = doc.createTreeWalker(root, page.NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        if (!/[\r\n]/.test(node.nodeValue ?? "") || node.parentElement?.closest("style,script,pre,code,textarea,svg,math,template"))
          continue;
        let parent = node.parentElement;
        let preformatted = false;
        while (parent) {
          if (/^(pre|pre-wrap|pre-line|break-spaces)$/.test(parent.style.whiteSpace)) {
            preformatted = true;
            break;
          }
          parent = parent.parentElement;
        }
        if (preformatted) continue;
        let value = (node.nodeValue ?? "").replace(/\r\n?/g, "\n");
        const previous = neighbor(node, "previousSibling");
        const next = neighbor(node, "nextSibling");
        if (!value.trim()) {
          if (!/^\n+$/.test(value) || !inline(previous) || !inline(next)) continue;
        } else {
          if (!inline(previous)) value = value.replace(/^[ \t]*\n[ \t\n]*/, "");
          if (!inline(next)) value = value.replace(/[ \t\n]*\n[ \t]*$/, "");
        }
        if (!value.includes("\n")) continue;
        const replacement = doc.createDocumentFragment();
        value.split("\n").forEach((line, index) => {
          if (index) replacement.appendChild(doc.createElement("br"));
          if (line) replacement.appendChild(doc.createTextNode(line));
        });
        node.replaceWith(replacement);
      }
    };
    const htmlDocuments = createHtmlDocumentRenderer({ page, doc, host, preserveLineBreaks: preserveTextLineBreaks });
    const htmlFragment = htmlDocuments.createFragment;
    const sanitizeContent = (root) => {
      root.querySelectorAll('script,iframe,object,embed,meta,base,form,link:not([rel="stylesheet"])').forEach((element) => element.remove());
      for (const element of root.querySelectorAll("*")) {
        for (const attribute of Array.from(element.attributes)) {
          if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
          else if (/^(?:href|src|xlink:href|action|formaction|to|from|values)$/i.test(attribute.name) && /(?:javascript|vbscript):|data:text\/html/i.test(attribute.value.replace(/\s/g, "")))
            element.removeAttribute(attribute.name);
        }
        if (element.tagName === "IMG") {
          element.loading = "lazy";
          element.decoding = "async";
        }
        if (element.tagName === "TEMPLATE") sanitizeContent(element.content);
      }
    };
    const renderContent = (id, message) => {
      const ctx = context();
      const regex = displayRegex();
      const render = markdownRenderer();
      const template = doc.createElement("template");
      reader.ignoreDepth.disabled = !regex;
      if (regex) {
        const source = message.extra?.type === "narrator" && !message.is_user ? "slash_command" : message.is_user ? "user_input" : "ai_output";
        const options = { character_name: message.name || void 0 };
        if (!reader.ignoreDepth.checked) {
          let depth = 0;
          if (Array.isArray(ctx?.chat)) {
            for (let next = id + 1; next < ctx.chat.length; next++) if (!ctx.chat[next].is_system) depth++;
          } else depth = Math.max(0, lastId() - id);
          options.depth = depth;
        }
        let text = regex(message.mes, source, "display", options);
        if (/^\s*(?:<!doctype\s+html\b|<html\b|<body\b)/i.test(text)) text = `\`\`\`html
${text}
\`\`\``;
        const fragments = [];
        let nonce;
        do {
          nonce = `BIRDFLOORHTML${Math.random().toString(36).slice(2).toUpperCase()}`;
        } while (text.includes(nonce));
        const markdown = text.replace(
          /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*(html?|xhtml)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\2[ \t]*(?=\r?\n|$)/gi,
          (_match, prefix, fence, _language, code) => {
            const token = `${nonce}${fragments.length}END`;
            fragments.push(htmlFragment(code));
            return `${prefix}

${token}

`;
          }
        );
        if (render) {
          let output = render(markdown);
          fragments.forEach((fragment, index) => {
            const token = `${nonce}${index}END`;
            output = output.replace(new RegExp(`<p>\\s*${token}\\s*</p>`, "g"), () => fragment);
            output = output.replaceAll(token, () => fragment);
          });
          template.innerHTML = output;
        } else {
          let output = markdown;
          fragments.forEach((fragment, index) => {
            output = output.replaceAll(`${nonce}${index}END`, () => fragment);
          });
          if (/<(?:div|p|section|article|style|html|body|table|h[1-6])\b/i.test(output)) template.innerHTML = output;
          else {
            const pre = doc.createElement("pre");
            pre.textContent = output;
            template.content.appendChild(pre);
          }
        }
      } else {
        const displayed = messageFormatter();
        if (displayed) template.innerHTML = displayed(message.mes, { message_id: id });
        else if (typeof ctx?.messageFormatting === "function")
          template.innerHTML = ctx.messageFormatting(
            message.mes,
            message.name || "",
            !!message.is_system,
            !!message.is_user,
            id
          );
        else if (render) template.innerHTML = render(message.mes);
        else {
          const pre = doc.createElement("pre");
          pre.textContent = message.mes;
          template.content.appendChild(pre);
        }
      }
      for (const code of template.content.querySelectorAll("pre > code")) {
        const markup = code.textContent ?? "";
        if (!/(?:language|lang)-(?:html|xhtml)\b|(?:^|\s)custom-html(?:\s|$)/i.test(code.className) && !/^\s*(?:<!doctype\s+html|<html\b)/i.test(markup))
          continue;
        const fragment = doc.createElement("template");
        fragment.innerHTML = htmlFragment(markup);
        code.parentElement.replaceWith(fragment.content);
      }
      preserveTextLineBreaks(template.content);
      return template;
    };
    const extractBody = (text) => {
      if (!reader.bodyOnly.checked) return text;
      const start = reader.start.value.trim();
      const end = reader.end.value.trim();
      if (!start || !end) throw new Error("请填写正文的起始和结束标签。");
      const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = [...text.matchAll(new RegExp(`${escape(start)}([\\s\\S]*?)${escape(end)}`, "g"))];
      return matches.length ? matches.map((match) => match[1]).join("\n\n") : text;
    };
    const pipeline = () => [displayRegex() || messageFormatter() || context()?.messageFormatting, markdownRenderer()];
    return { renderContent, extractBody, sanitizeContent, ...htmlDocuments, pipeline };
  }

  // positioning.ts
  function findCurrentFloor(page, doc, chat, messages) {
    if (!chat || !chat.getClientRects().length) return null;
    const bounds = chat.getBoundingClientRect();
    const top = Math.max(bounds.top + chat.clientTop, 0);
    const bottom = Math.min(bounds.top + chat.clientTop + chat.clientHeight, page.innerHeight);
    if (bottom <= top) return null;
    const line = top + Math.min(72, (bottom - top) * 0.2);
    for (const ratio of [0.5, 0.25, 0.75]) {
      const x = Math.max(0, Math.min(page.innerWidth - 1, bounds.left + bounds.width * ratio));
      for (const hit of doc.elementsFromPoint(x, line)) {
        const element = hit.closest(".mes[mesid]");
        if (element && chat.contains(element) && /^\d+$/.test(element.getAttribute("mesid") ?? "")) return element;
      }
    }
    let nearest = null;
    let distance = Infinity;
    let low = 0;
    let high = messages.length - 1;
    while (low <= high) {
      const middle = low + high >>> 1;
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
  function contentTop(chat, element) {
    return chat.scrollTop + element.getBoundingClientRect().top - chat.getBoundingClientRect().top - chat.clientTop;
  }
  function viewportBounds(page) {
    const visual = page.visualViewport;
    return {
      x: visual?.offsetLeft ?? 0,
      y: visual?.offsetTop ?? 0,
      width: visual?.width ?? page.innerWidth,
      height: visual?.height ?? page.innerHeight
    };
  }

  // cat-icons.ts
  var svg = (title, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" role="img"><title>${title}</title><g stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
  var CAT_ICON = /* @__PURE__ */ svg("来信喵", `
      <path d="M18 31V13q0-3 3-1l8 6h8l7-6q3-2 3 1v18" fill="var(--cat-face,#7296be)"/>
      <path d="m23 26 3 1 2-1m9 0 3 1 2-1" stroke="var(--cat-ear,#f1f6ff)" stroke-width="2"/>
      <path d="m31 30 2 1 2-1" stroke="var(--cat-ear,#f1f6ff)" stroke-width="1.8"/>
      <rect x="9" y="33" width="46" height="23" rx="5" fill="var(--cat-ear,#f1f6ff)" stroke="var(--cat-line,#345577)" stroke-width="2"/>
      <path d="m10 36 18 12q4 3 8 0l18-12M11 53l13-10m29 10L40 43" stroke="var(--cat-line,#345577)" stroke-width="1.8"/>
      <path d="M21 33v5m23-5v5" stroke="var(--cat-face,#7296be)" stroke-width="6"/>
      <path d="m53 11 1.2 3.8L58 16l-3.8 1.2L53 21l-1.2-3.8L48 16l3.8-1.2Z" fill="var(--cat-face,#7296be)"/>
    `);

  // inline-css:/home/runner/work/meow-message-assistant/meow-message-assistant/assistant.css
  var assistant_default = `:host {
  all: initial;
  position: fixed;
  right: max(16px, env(safe-area-inset-right));
  top: 42%;
  z-index: 2147483000;
  font-family:
    system-ui,
    -apple-system,
    'Microsoft YaHei',
    sans-serif;
  color: #304d47;
  color-scheme: light;
}
*,
*::before,
*::after {
  box-sizing: border-box;
}
.wrap {
  position: relative;
}
button,
input {
  font: inherit;
}
button {
  cursor: pointer;
  touch-action: manipulation;
}
button:disabled {
  cursor: default;
  opacity: 0.42;
}
svg {
  display: block;
  width: 22px;
  height: 22px;
  pointer-events: none;
}
.rail {
  width: 58px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 5px;
  gap: 4px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 32px;
  box-shadow: 0 6px 24px #233c3329;
}
.dock-handle {
  display: none;
  position: absolute;
  z-index: 5;
  top: 0;
  bottom: 0;
  right: 0;
  width: 28px;
  height: auto;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  appearance: none;
  background: transparent;
  transform: none;
  touch-action: none;
}
.dock-handle::before {
  content: '';
  position: absolute;
  top: 50%;
  right: 0;
  width: 4px;
  height: 58px;
  border-radius: 4px 0 0 4px;
  background: var(--muted);
  opacity: 0.7;
  transform: translateY(-50%);
  pointer-events: none;
  transition:
    width 160ms,
    opacity 160ms;
}
.dock-handle:active::before {
  width: 7px;
  opacity: 1;
}
.rail button {
  display: grid;
  place-items: center;
  width: 46px;
  height: 44px;
  padding: 0;
  color: var(--ink);
  border: 0;
  border-radius: 24px;
  background: transparent;
  transition:
    background 150ms,
    transform 150ms;
}
.rail button:hover:not(:disabled) {
  background: var(--accent);
}
/* The edge handle's hit area must stay still while a pointer is pressed. */
button:active:not(:disabled):not(.dock-handle) {
  transform: scale(0.94);
}
.rail .bird {
  height: 54px;
  background: var(--accent);
  touch-action: none;
  user-select: none;
}
.bird svg {
  width: 48px;
  height: 48px;
}
.floor {
  font-size: 11px;
  line-height: 18px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  max-width: 48px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rail .back {
  border-top: 1px solid var(--line);
  border-radius: 8px 8px 22px 22px;
}
.panel {
  position: fixed;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: clamp(18px, 4vw, 48px);
  background: var(--surface);
  border: 0;
  border-radius: 0;
}
.wrap.panel-open .rail {
  visibility: hidden;
}
.wrap.panel-open .dock-handle {
  visibility: hidden;
  pointer-events: none;
}
[hidden] {
  display: none !important;
}
.heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 18px;
}
h2 {
  font-size: 18px;
  letter-spacing: 0.03em;
  margin: 0;
  font-weight: 650;
}
.close {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin: -10px -10px -10px 0;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: var(--muted);
}
.close:hover {
  background: var(--accent);
}
.location {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
}
label {
  display: block;
  font-size: 13px;
  margin-bottom: 8px;
}
.row {
  display: flex;
  gap: 8px;
}
input {
  width: 0;
  min-width: 0;
  flex: 1;
  height: 46px;
  padding: 0 12px;
  color: var(--ink);
  background: var(--control);
  border: 1px solid var(--line);
  border-radius: 12px;
  font-size: 16px;
}
.go {
  min-width: 64px;
  height: 46px;
  border: 1px solid var(--primary);
  border-radius: 12px;
  background: var(--primary);
  color: var(--on-primary);
  font-size: 14px;
}
.return {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 44px;
  background: var(--accent);
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--ink);
  font-size: 13px;
}
.bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 14px;
}
.side {
  height: 44px;
  padding: 0 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--ink);
  font-size: 12px;
  white-space: nowrap;
}
.side:hover {
  background: var(--accent);
}
.status {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  color: var(--ink);
}
.status:empty {
  display: none;
}
.toast {
  position: absolute;
  right: 70px;
  top: 0;
  width: 220px;
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: 0 6px 24px #233c3329;
  font-size: 13px;
  line-height: 1.6;
}
.wrap.left .toast {
  right: auto;
  left: 70px;
}
.rail,
.panel,
.toast {
  z-index: 3;
}
.rail {
  position: relative;
}
.reader-mask {
  position: fixed;
  inset: 0;
  background: #15202d66;
  z-index: 1;
}
:host([data-theme='dark']) .reader-mask {
  background: #0009;
}
.reader {
  position: fixed;
  display: flex;
  flex-direction: column;
  border: 0;
  border-radius: 0;
  overflow: hidden;
  background: var(--surface);
  z-index: 2;
}
.reader-head {
  padding: 14px 18px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--line);
}
.reader-heading {
  flex: 1;
  min-width: 110px;
}
.reader-heading h2 {
  font-size: 16px;
}
.reader-head button {
  height: 44px;
  min-width: 44px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  background: var(--accent);
  color: var(--ink);
  border-radius: 10px;
  padding: 0 10px;
  font-size: 13px;
}
.reader-frame {
  display: block;
  border: 0;
  width: 100%;
  flex: 1;
  min-height: 0;
  background: var(--surface);
}
.reader-options {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 18px;
  min-height: 44px;
  border-bottom: 1px solid var(--line);
}
.reader-options label {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  margin: 0;
  font-size: 12px;
  cursor: pointer;
}
.reader-options input {
  width: 18px;
  height: 18px;
  flex: none;
  padding: 0;
  margin: 0;
  accent-color: #39776c;
}
.reader-options input:disabled {
  opacity: 0.45;
}
.wrap {
  --ink: #263e59;
  --muted: #586f89;
  --surface: #fff;
  --control: #f7faff;
  --line: #c5d4e6;
  --accent: #e7eff9;
  --primary: #386aab;
  --on-primary: #fff;
  --focus: #4b80c2;
  --shadow: #17385d24;
  --cat-face: #739ac0;
  --cat-ear: #edf5ff;
  --cat-line: #2d5275;
  color: var(--ink);
}
:host([data-theme='dark']) .wrap {
  --ink: #e4e7eb;
  --muted: #a6adb7;
  --surface: #181b20;
  --control: #22262c;
  --line: #464d58;
  --accent: #303640;
  --primary: #d1d7e0;
  --on-primary: #1b1e23;
  --focus: #adbdd2;
  --shadow: #0007;
  --cat-face: #a6b6cb;
  --cat-ear: #222832;
  --cat-line: #d1dbe6;
  color-scheme: dark;
}
.rail,
.panel,
.reader,
.toast {
  box-shadow: 0 8px 28px var(--shadow);
}
button:focus-visible,
input:focus-visible,
summary:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}
.rail .bird {
  background: var(--accent);
}
.rail .back {
  border-color: var(--line);
}
input {
  color: var(--ink);
  background: var(--control);
  border-color: var(--line);
}
.go {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}
.panel {
  z-index: 6;
  box-shadow: none;
  padding-top: max(18px, env(safe-area-inset-top));
  padding-bottom: max(18px, env(safe-area-inset-bottom));
}
.panel .heading {
  flex: none;
  margin: 0;
}
.panel .close {
  margin: 0;
}
.panel-main {
  width: min(620px, 100%);
  margin: auto;
  padding: 28px 0;
}
.panel-emblem {
  display: grid;
  place-items: center;
  margin: 0 auto 28px;
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: var(--accent);
}
.panel-emblem svg {
  width: 100px;
  height: 100px;
}
.panel form > label {
  font-size: 14px;
  margin-bottom: 12px;
}
.panel .row input {
  height: 64px;
  font-size: 24px;
  padding: 0 18px;
  border-radius: 16px;
}
.panel .go {
  height: 64px;
  min-width: 88px;
  font-size: 16px;
  border-radius: 16px;
}
.panel-edges {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 16px 0;
}
.panel-edges button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 52px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 14px;
  color: var(--ink);
  background: var(--control);
  font-size: 14px;
}
.panel .return {
  height: 52px;
  font-size: 14px;
}
.panel-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 16px 0;
}
.panel-actions button,
.reader-actions button {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--ink);
  background: var(--control);
  font-size: 13px;
}
.bottom {
  justify-content: flex-end;
  margin-top: 6px;
}
.reader-head {
  padding: 12px 16px;
}
.reader-heading {
  min-width: 100px;
}
.reader-heading h2 {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reader-swipes {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 44px auto;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--line);
}
.reader-swipes button {
  min-width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--ink);
  background: var(--control);
  font-size: 13px;
}
.swipe-count {
  text-align: center;
  font-size: 13px;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
}
.reader-actions {
  position: relative;
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 0 16px 8px;
  border-bottom: 1px solid var(--line);
}
.reader-actions button[aria-pressed='true'] {
  background: var(--accent);
  border-color: var(--primary);
}
.bookmark-title-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  color: var(--muted);
  font-size: 12px;
}
.bookmark-title {
  width: min(220px, 32vw);
  min-width: 110px;
  height: 44px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--ink);
  background: var(--control);
  font-size: 13px;
}
.reader-settings {
  min-width: 0;
}
.reader-settings summary {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--ink);
  background: var(--control);
  font-size: 13px;
  cursor: pointer;
  list-style: none;
}
.reader-settings summary::-webkit-details-marker {
  display: none;
}
.reader-settings[open] summary {
  background: var(--accent);
  border-color: var(--primary);
}
.reader-options {
  position: absolute;
  left: 12px;
  top: calc(100% + 6px);
  z-index: 4;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  width: min(460px, calc(100% - 24px));
  gap: 8px 12px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: 0 8px 28px var(--shadow);
  max-height: min(260px, 35dvh, var(--settings-room, 260px));
  overflow: auto;
  overscroll-behavior: contain;
}
.reader-options .tag-field {
  display: block;
  min-width: 0;
  font-size: 12px;
}
.reader-options .tag-field span {
  display: block;
  margin-bottom: 4px;
}
.reader-options .tag-field input {
  display: block;
  width: 100%;
  height: 44px;
  padding: 0 10px;
  font-size: 16px;
}
.reader-frame {
  background: var(--surface);
}
.panel-actions button {
  min-height: 52px;
}
@media (max-width: 600px) {
  .panel .heading {
    margin-bottom: 4px;
  }
  .panel-main {
    margin: 8px auto 0;
    padding: 8px 0;
  }
  .panel-actions {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin: 12px 0;
  }
  .panel-actions button {
    min-height: 44px;
  }
  .panel-emblem {
    width: 72px;
    height: 72px;
    margin-bottom: 14px;
  }
  .panel-emblem svg {
    width: 60px;
    height: 60px;
  }
  .panel-edges {
    gap: 8px;
    margin: 12px 0;
  }
  .panel-edges button {
    min-height: 44px;
    padding: 8px;
  }
  .panel .return {
    height: 44px;
  }
  .panel .row input,
  .panel .go {
    height: 48px;
  }
}
@media (max-height: 450px) {
  .panel-emblem {
    display: none;
  }
  .panel-main {
    margin: 12px auto 0;
    padding: 0;
  }
}
.history-browser {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 10px 16px;
  gap: 10px;
}
.history-search {
  width: 100%;
  min-height: 44px;
  flex: none;
}
.history-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
}
.history-filters .history-search {
  flex: 1 1 220px;
  min-width: 0;
}
.history-filters label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  font-size: 12px;
  white-space: nowrap;
}
.history-hide-bookmarks {
  width: 18px;
  height: 18px;
  margin: 0;
}
.history-list {
  overflow: auto;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.history-card {
  display: block;
  width: 100%;
  flex: none;
  text-align: left;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--control);
  color: var(--ink);
}
.history-card:hover {
  background: var(--accent);
}
.history-card strong {
  font-size: 14px;
}
.history-card span {
  display: block;
  margin-top: 5px;
  font-size: 12px;
  color: var(--muted);
}
.history-card p {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.6;
  max-height: 4.8em;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.history-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: 13px;
}
.history-pagination button {
  min-height: 44px;
  padding: 0 12px;
  background: var(--control);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 10px;
}
.history-empty {
  padding: 24px 8px;
  font-size: 14px;
  color: var(--muted);
  text-align: center;
}
.version { color: var(--muted); font-size: 11px; font-weight: 400; white-space: nowrap; }
.auto-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; }
.auto-controls button,.auto-controls select { min-height: 44px; padding: 0 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--control); color: var(--ink); font-size: 13px; }
.auto-controls button[aria-pressed="true"] { background: var(--accent); border-color: var(--primary); }
.auto-controls .auto-next { display: flex; align-items: center; gap: 6px; min-height: 44px; margin: 0; font-size: 12px; }
.auto-next input { flex: none; width: 18px; height: 18px; margin: 0; padding: 0; }
.reader-auto { flex: none; padding: 0 12px 6px; border-bottom: 1px solid var(--line); }
.reader-auto .auto-controls { margin-top: 4px; }
.auto-float { position: fixed; z-index: 8; left: max(12px, env(safe-area-inset-left)); bottom: max(12px, env(safe-area-inset-bottom)); min-height: 44px; padding: 0 16px; border: 1px solid var(--line); border-radius: 24px; background: var(--surface); color: var(--ink); box-shadow: 0 4px 20px var(--shadow); font-size: 13px; }
.bird,.dock-handle { -webkit-touch-callout: none; user-select: none; }
.wrap:not(.mobile) .panel {
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 20px;
  box-shadow: 0 12px 40px var(--shadow);
}
.wrap:not(.mobile) .panel h2 { font-size: 16px; }
.wrap:not(.mobile) .panel-main { margin: 16px auto 0; padding: 0; }
.wrap:not(.mobile) .panel-emblem { width: 56px; height: 56px; margin-bottom: 16px; }
.wrap:not(.mobile) .panel-emblem svg { width: 48px; height: 48px; }
.wrap:not(.mobile) .panel form > label { margin-bottom: 8px; }
.wrap:not(.mobile) .panel .row input { height: 48px; font-size: 18px; padding: 0 12px; border-radius: 12px; }
.wrap:not(.mobile) .panel .go { height: 48px; min-width: 64px; font-size: 14px; border-radius: 12px; }
.wrap:not(.mobile) .panel-edges { gap: 8px; margin: 12px 0; }
.wrap:not(.mobile) .panel-edges button { min-height: 44px; padding: 8px; font-size: 13px; }
.wrap:not(.mobile) .panel-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 12px 0; }
.wrap:not(.mobile) .panel-actions button { min-height: 44px; }
.wrap:not(.mobile) .panel .return { height: 44px; }
.wrap:not(.mobile) .reader { border: 1px solid var(--line); border-radius: 18px; }
.wrap.mobile .rail {
  width: 48px;
  padding: 2px;
  border-radius: 24px 0 0 24px;
  gap: 2px;
  transition: transform 180ms ease;
}
.wrap.mobile:not(.rail-expanded) .rail {
  transform: translateX(100%);
  visibility: hidden;
  pointer-events: none;
}
.wrap.mobile.rail-expanded .rail {
  transform: translateX(0);
}
.wrap.mobile .dock-handle {
  display: block;
}
.wrap.mobile.rail-expanded .dock-handle {
  right: 100%;
}
.wrap.mobile .dock-handle:focus-visible {
  outline: none;
}
.wrap.mobile .dock-handle:focus-visible::before {
  width: 7px;
  opacity: 1;
}
.wrap.mobile.left .rail {
  border-radius: 0 24px 24px 0;
}
.wrap.mobile .rail button {
  width: 44px;
  height: 44px;
}
.wrap.mobile .rail .bird {
  height: 48px;
}
.wrap.mobile .bird svg {
  width: 40px;
  height: 40px;
}
.wrap.mobile.shelved .rail {
  flex-direction: column;
  width: 48px;
  padding: 3px;
  border-radius: 24px 0 0 24px;
  gap: 2px;
}
.wrap.mobile.shelved .rail > .floor,
.wrap.mobile.shelved .rail > .back {
  display: none;
}
.wrap.mobile.shelved .rail > .up,
.wrap.mobile.shelved .rail > .down {
  display: grid;
}
.wrap.mobile.shelved .rail {
  opacity: 0.8;
}
.wrap.mobile.shelved .rail:hover,
.wrap.mobile.shelved .rail:focus-within {
  opacity: 1;
}
.wrap.compact.short .reader-head {
  grid-template-columns: minmax(0, 1fr) auto;
}
.wrap.compact.short .reader-heading {
  grid-column: auto;
}
.wrap.compact.short .reader-prev,
.wrap.compact.short .reader-next,
.wrap.compact.short .reader-latest,
.wrap.compact.short .reader-swipes,
.wrap.compact.short .reader-raw,
.wrap.compact.short .reader-archive {
  display: none;
}
@media (max-width: 600px) {
  .reader-head {
    display: grid;
    grid-template-columns: 44px 44px minmax(0, 1fr) auto;
    gap: 6px;
    padding: 10px;
  }
  .reader-heading {
    grid-column: 1/-1;
    padding: 2px 0 4px;
  }
  .reader-head button {
    padding: 0 9px;
  }
  .reader-swipes {
    padding: 6px 10px;
    gap: 6px;
  }
  .reader-actions {
    padding: 0 10px 6px;
    gap: 6px;
  }
  .reader-options {
    gap: 6px 8px;
  }
}
input[type='checkbox'] {
  accent-color: var(--primary);
}
@media (max-width: 600px) {
  .reader-head {
    padding-top: max(10px, env(safe-area-inset-top));
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition: none !important;
  }
}
`;

  // version.ts
  var SCRIPT_VERSION = "2.7.0";

  // ui.ts
  function createAssistantUi(doc) {
    const icon = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    const cat = CAT_ICON;
    const autoControls = () => `<div class="auto-controls"><button class="auto-toggle" type="button" aria-pressed="false">自动阅读</button><select class="auto-speed" aria-label="自动阅读速度"><option value="16">慢速</option><option value="24" selected>舒适</option><option value="40">较快</option><option value="64">快速</option></select><label class="auto-next"><input class="auto-continue" type="checkbox">读完续楼</label></div>`;
    const host = doc.createElement("div");
    host.id = "bird-floor-navigator";
    host.dataset.version = SCRIPT_VERSION;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>${assistant_default}</style>
      <div class="wrap">
        <button class="dock-handle" type="button" aria-label="展开侧边按钮" aria-expanded="false" title="展开侧边按钮"></button>
        <div class="rail" role="group" aria-label="喵喵消息助手">
          <button class="up" type="button" title="当前楼层顶部" aria-label="回到当前楼层顶部">${icon('<path d="m6 14 6-6 6 6"/><path d="M6 4h12"/>')}</button>
          <button class="bird" type="button" title="喵喵消息助手 · 拖动挪位置" aria-label="展开楼层跳转，亦可拖动调整位置" aria-expanded="false" aria-controls="bird-panel">${cat}</button>
          <span class="floor" aria-hidden="true">—</span>
          <button class="down" type="button" title="当前楼层底部" aria-label="前往当前楼层底部">${icon('<path d="m6 10 6 6 6-6"/><path d="M6 20h12"/>')}</button>
          <button class="back" type="button" title="返回跳转前的位置" aria-label="返回跳转前的阅读位置" disabled>${icon('<path d="m9 5-5 5 5 5"/><path d="M4 10h10a6 6 0 0 1 0 12"/>')}</button>
        </div>
        <section class="panel" id="bird-panel" role="dialog" aria-modal="true" aria-labelledby="bird-title" tabindex="-1" hidden>
          <div class="heading"><div><h2 id="bird-title">喵喵消息助手 <span class="version">v${SCRIPT_VERSION}</span></h2><p class="location"></p></div><button class="close" type="button" aria-label="收起面板">${icon('<path d="m6 6 12 12M6 18 18 6"/>')}</button></div>
          <div class="panel-main"><div class="panel-emblem">${cat}</div>
          <form novalidate><label for="bird-floor-input">楼层</label><div class="row"><input id="bird-floor-input" inputmode="numeric" autocomplete="off" aria-describedby="bird-status"><button class="go" type="submit">跳转</button></div></form>
          <div class="panel-edges"><button class="panel-up" type="button">${icon('<path d="m6 14 6-6 6 6"/><path d="M6 4h12"/>')}本层顶部</button><button class="panel-down" type="button">${icon('<path d="m6 10 6 6 6-6"/><path d="M6 20h12"/>')}本层底部</button></div>
          <div class="panel-actions"><button class="view-message" type="button">查看消息</button><button class="view-swipes" type="button">历史回复</button><button class="view-archive" type="button">回复目录</button><button class="view-bookmarks" type="button">收藏夹</button></div>
          <button class="return" type="button" disabled>${icon('<path d="m9 5-5 5 5 5"/><path d="M4 10h10a6 6 0 0 1 0 12"/>')}<span>还没有需要返回的位置</span></button>
          ${autoControls()}
          <div class="bottom"><button class="side" type="button">移到左侧</button></div>
          <p class="status" id="bird-status" role="status" aria-live="polite" aria-atomic="true"></p></div>
        </section>
        <div class="toast" role="status" aria-live="polite" hidden></div>
        <button class="auto-float" type="button" hidden>暂停自动阅读</button>
        <div class="reader-mask" hidden></div>
        <section class="reader" role="dialog" aria-labelledby="bird-reader-title" tabindex="-1" hidden>
          <div class="reader-head"><div class="reader-heading"><h2 id="bird-reader-title">消息</h2></div>
            <button class="reader-prev" type="button" title="上一楼" aria-label="阅读上一楼">${icon('<path d="m14 6-6 6 6 6"/>')}</button>
            <button class="reader-next" type="button" title="下一楼" aria-label="阅读下一楼">${icon('<path d="m10 6 6 6-6 6"/>')}</button>
            <button class="reader-latest" type="button">最新</button>
            <button class="reader-exit" type="button">返回聊天</button>
          </div>
          <div class="reader-swipes"><button class="swipe-prev" type="button" aria-label="查看上一版本回复">${icon('<path d="m14 6-6 6 6 6"/>')}</button><span class="swipe-count"></span><button class="swipe-next" type="button" aria-label="查看下一版本回复">${icon('<path d="m10 6 6 6-6 6"/>')}</button><button class="swipe-current" type="button">当前</button></div>
          <div class="reader-actions"><button class="reader-bookmark" type="button" aria-pressed="false">☆ 收藏</button><label class="bookmark-title-wrap"><span>备注</span><input class="bookmark-title" type="text" maxlength="80" placeholder="番外·xx小剧场" aria-label="当前楼层的收藏备注标题"></label><button class="reader-bookmarks" type="button">收藏夹</button><button class="reader-raw" type="button" aria-pressed="false">原文</button><button class="reader-refresh" type="button">刷新</button><button class="reader-archive" type="button">回复目录</button><details class="reader-settings"><summary>显示设置</summary><div class="reader-options"><label><input class="reader-ignore-depth" type="checkbox" checked>忽略深度限制</label><label><input class="reader-body-only" type="checkbox">仅正文</label><label><input class="reader-skip-bookmarks" type="checkbox" checked>跳过收藏楼层</label><label class="tag-field"><span>起始标签</span><input class="reader-start-tag" value="&lt;content&gt;" autocomplete="off"></label><label class="tag-field"><span>结束标签</span><input class="reader-end-tag" value="&lt;/content&gt;" autocomplete="off"></label></div></details></div>
          <div class="reader-auto">${autoControls()}</div>
          <section class="history-browser" aria-label="消息目录" hidden><div class="history-filters"><input class="history-search" type="search" aria-label="搜索楼层、标题、角色或内容" placeholder="搜索楼层、标题、角色或内容"><label><input class="history-hide-bookmarks" type="checkbox">隐藏收藏楼层</label></div><div class="history-list"></div><div class="history-pagination"><button class="history-previous" type="button">上一页</button><span class="history-page"></span><button class="history-next" type="button">下一页</button></div></section>
          <iframe class="reader-frame" title="历史楼层正文" sandbox="allow-same-origin allow-scripts" referrerpolicy="no-referrer"></iframe>
        </section>
      </div>`;
    doc.body.appendChild(host);
    const $2 = (selector) => shadow.querySelector(selector);
    const ui = {
      wrap: $2(".wrap"),
      rail: $2(".rail"),
      dockHandle: $2(".dock-handle"),
      panel: $2(".panel"),
      bird: $2(".bird"),
      input: $2("#bird-floor-input"),
      status: $2(".status"),
      toast: $2(".toast"),
      up: $2(".up"),
      down: $2(".down"),
      panelUp: $2(".panel-up"),
      panelDown: $2(".panel-down"),
      back: $2(".back"),
      return: $2(".return"),
      go: $2(".go"),
      floor: $2(".floor"),
      location: $2(".location"),
      side: $2(".side"),
      view: $2(".view-message"),
      swipes: $2(".view-swipes"),
      viewBookmarks: $2(".view-bookmarks")
    };
    const reader = {
      panel: $2(".reader"),
      mask: $2(".reader-mask"),
      frame: $2(".reader-frame"),
      title: $2("#bird-reader-title"),
      previous: $2(".reader-prev"),
      next: $2(".reader-next"),
      exit: $2(".reader-exit"),
      latest: $2(".reader-latest"),
      ignoreDepth: $2(".reader-ignore-depth"),
      bodyOnly: $2(".reader-body-only"),
      start: $2(".reader-start-tag"),
      end: $2(".reader-end-tag"),
      raw: $2(".reader-raw"),
      bookmark: $2(".reader-bookmark"),
      bookmarkTitle: $2(".bookmark-title"),
      bookmarks: $2(".reader-bookmarks"),
      skipBookmarks: $2(".reader-skip-bookmarks"),
      refresh: $2(".reader-refresh"),
      settings: $2(".reader-settings"),
      swipePrevious: $2(".swipe-prev"),
      swipeNext: $2(".swipe-next"),
      swipeCurrent: $2(".swipe-current"),
      swipeCount: $2(".swipe-count")
    };
    const archive = {
      panel: $2(".history-browser"),
      search: $2(".history-search"),
      hideBookmarks: $2(".history-hide-bookmarks"),
      list: $2(".history-list"),
      previous: $2(".history-previous"),
      next: $2(".history-next"),
      page: $2(".history-page")
    };
    return { host, shadow, $: $2, ui, reader, archive };
  }

  // auto-reader.ts
  function createAutoReader({ page, target, onEnd, onChange }) {
    let running = false, speed = 24, frame = 0, previous = 0, fraction = 0, generation = 0;
    let lastTarget = null;
    try {
      const saved = Number(page.localStorage.getItem("meow-reading-speed"));
      if ([16, 24, 40, 64].includes(saved)) speed = saved;
    } catch (_) {
    }
    const pause = () => {
      running = false;
      generation++;
      page.cancelAnimationFrame(frame);
      frame = previous = fraction = 0;
      onChange(running, speed);
    };
    const tick = async (time) => {
      frame = 0;
      if (!running) return;
      const element = target();
      if (!element || !element.isConnected || page.document.hidden) {
        pause();
        return;
      }
      if (element !== lastTarget) {
        previous = 0;
        fraction = 0;
        lastTarget = element;
      }
      const elapsed = previous ? Math.min(100, time - previous) : 0;
      previous = time;
      const bottom = element.scrollHeight - element.clientHeight;
      if (element.scrollTop >= bottom - 1) {
        const token = generation;
        let next = false;
        try {
          next = await onEnd();
        } catch (_) {
        }
        if (!running || token !== generation) return;
        if (!next) {
          pause();
          return;
        }
        previous = fraction = 0;
      } else {
        fraction += speed * elapsed / 1e3;
        const pixels = Math.floor(fraction);
        if (pixels) {
          element.scrollTop += pixels;
          fraction -= pixels;
        }
      }
      if (running) frame = page.requestAnimationFrame(tick);
    };
    return {
      pause,
      get running() {
        return running;
      },
      get speed() {
        return speed;
      },
      start() {
        if (running || !target()) return;
        running = true;
        previous = fraction = 0;
        generation++;
        onChange(running, speed);
        frame = page.requestAnimationFrame(tick);
      },
      setSpeed(value) {
        if (![16, 24, 40, 64].includes(value)) return;
        speed = value;
        try {
          page.localStorage.setItem("meow-reading-speed", String(speed));
        } catch (_) {
        }
        onChange(running, speed);
      }
    };
  }

  // dock-drag.ts
  function bindDockDrag({ controls, enabled, onMove, onEnd, host }) {
    const removers = [];
    let active = null;
    const suppressed = /* @__PURE__ */ new WeakMap();
    for (const control of controls) {
      const listen = (type, handler, options) => {
        control.addEventListener(type, handler, options);
        removers.push(() => control.removeEventListener(type, handler, options));
      };
      listen("pointerdown", ((event) => {
        if (!enabled() || active || !event.isPrimary || event.button !== 0) return;
        suppressed.delete(control);
        active = {
          control,
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          rect: host.getBoundingClientRect(),
          moved: false,
          threshold: event.pointerType === "touch" ? 10 : 7
        };
        control.setPointerCapture(event.pointerId);
      }));
      listen("pointermove", ((event) => {
        if (!active || event.pointerId !== active.id) return;
        const dx = event.clientX - active.x, dy = event.clientY - active.y;
        if (!active.moved && Math.hypot(dx, dy) < active.threshold) return;
        active.moved = true;
        onMove(dx, dy, active.rect);
      }));
      const finish = ((event) => {
        if (!active || event.pointerId !== active.id) return;
        const gesture = active;
        active = null;
        if (gesture.moved) {
          suppressed.set(control, Date.now() + 500);
          onEnd();
        }
        if (control.hasPointerCapture(event.pointerId)) control.releasePointerCapture(event.pointerId);
      });
      listen("pointerup", finish);
      listen("pointercancel", finish);
      listen("lostpointercapture", finish);
      listen("click", ((event) => {
        if (event.detail && Date.now() < (suppressed.get(control) ?? 0)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          suppressed.delete(control);
        }
      }), { capture: true });
    }
    return () => {
      const gesture = active;
      active = null;
      if (gesture?.control.hasPointerCapture(gesture.id)) gesture.control.releasePointerCapture(gesture.id);
      removers.forEach((remove) => remove());
    };
  }

  // assistant.ts
  var KEY = "__birdFloorNavigator_v1__";
  var POSITION_KEY = "bird-floor-position-v1";
  function startAssistant() {
    let page;
    try {
      page = window.parent;
      void page.document.body;
    } catch (error) {
      console.error("[喵喵消息助手] 无法访问酒馆主页面", error);
      return;
    }
    const doc = page.document;
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
    let collectionMode = "replies";
    let archivePage = 0;
    let archiveRows = [];
    let bookmarkRows = [];
    let searchTimer = 0;
    const renderCache = /* @__PURE__ */ new Map();
    let renderPipeline = [];
    let layoutFrame = 0;
    let chat = null;
    let messages = [];
    let identity = "";
    let bookmarkedIds = /* @__PURE__ */ new Map();
    let bookmarkTitleFloor = null;
    let highlighted = null;
    let highlightTimer = 0;
    let position = null;
    try {
      position = JSON.parse(page.localStorage.getItem(POSITION_KEY));
    } catch (_) {
    }
    const { host, shadow, $: $2, ui, reader, archive } = createAssistantUi(doc);
    let toastTimer = 0;
    const listen = (target, type, fn, options) => {
      target.addEventListener(type, fn, options);
      cleanups.push(() => target.removeEventListener(type, fn, options));
    };
    const themeMedia = page.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      host.dataset.theme = themeMedia.matches ? "dark" : "light";
      try {
        const inside = reader.frame.contentDocument;
        if (inside) {
          inside.documentElement.dataset.theme = host.dataset.theme;
          messageRenderer.syncDocumentTheme(inside);
        }
      } catch (_) {
      }
    };
    listen(themeMedia, "change", applyTheme);
    const context = () => {
      try {
        return page.SillyTavern?.getContext?.() ?? (typeof SillyTavern !== "undefined" ? SillyTavern : null);
      } catch (_) {
        return null;
      }
    };
    const chatKey = (ctx) => ctx ? `${ctx.characterId ?? ""}|${ctx.groupId ?? ""}|${ctx.getCurrentChatId?.() ?? ""}` : "";
    const bookmarkStorageKey = (key) => `meow-message-bookmarks-v1:${key}`;
    const loadBookmarks = (key) => {
      try {
        const stored = JSON.parse(page.localStorage.getItem(bookmarkStorageKey(key)) || "[]");
        const entries = Array.isArray(stored) ? stored.filter((id) => Number.isSafeInteger(id) && id >= 0).map((id) => [id, ""]) : Object.entries(stored ?? {}).flatMap(([rawId, title]) => {
          const id = Number(rawId);
          return Number.isSafeInteger(id) && id >= 0 ? [[id, typeof title === "string" ? title : ""]] : [];
        });
        bookmarkedIds = new Map(entries);
      } catch (_) {
        bookmarkedIds = /* @__PURE__ */ new Map();
      }
    };
    const saveBookmarks = () => {
      try {
        page.localStorage.setItem(bookmarkStorageKey(identity), JSON.stringify(Object.fromEntries(bookmarkedIds)));
      } catch (_) {
      }
    };
    const isBookmarked = (id) => bookmarkedIds.has(id);
    const getBookmarkTitle = (id) => bookmarkedIds.get(id) ?? "";
    const findNeighborId = (from, delta) => {
      for (let id = from + delta; id >= 0 && id <= lastId(); id += delta)
        if (!reader.skipBookmarks.checked || !isBookmarked(id)) return id;
      return null;
    };
    const floorId = (el) => Number(el.getAttribute("mesid"));
    const floorElement = (id) => chat?.querySelector(`.mes[mesid="${id}"]`);
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
        return readerState ? readerDocument()?.scrollingElement ?? null : chat;
      },
      onEnd: async () => {
        if (!continueReading || !readerState || archiveMode || busy || disposed) return false;
        const nextId = findNeighborId(readerState.id, 1);
        if (nextId === null) return false;
        return new Promise((resolve) => {
          const finish = (ok) => {
            page.clearTimeout(timeout);
            reader.frame.removeEventListener("load", loaded);
            resolve(ok && !disposed && readerState?.id === nextId);
          };
          const loaded = () => page.setTimeout(() => finish(true), 0);
          const timeout = page.setTimeout(() => finish(false), 5e3);
          reader.frame.addEventListener("load", loaded);
          goTo(nextId, generation, true, 0, { focus: false }).catch(() => finish(false));
        });
      },
      onChange: (running, speed) => {
        shadow.querySelectorAll(".auto-toggle").forEach((button) => {
          button.textContent = running ? "暂停阅读" : "自动阅读";
          button.setAttribute("aria-pressed", String(running));
        });
        shadow.querySelectorAll(".auto-speed").forEach((select) => select.value = String(speed));
        $2(".auto-float").hidden = !running || !reader.panel.hidden;
      }
    });
    const hideReader = () => {
      autoReader.pause();
      messageRenderer.unmountDocuments();
      readerState = null;
      archiveMode = false;
      readerLoad++;
      reader.panel.hidden = reader.mask.hidden = true;
      reader.frame.removeAttribute("srcdoc");
      ui.wrap.classList.remove("compact");
    };
    const currentFloor = () => findCurrentFloor(page, doc, chat, messages);
    const contentTop2 = (el) => chat ? contentTop(chat, el) : 0;
    const showStatus = (message) => {
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
        if (typeof getLastMessageId === "function") return getLastMessageId();
      } catch (_) {
      }
      return messages.reduce((max, el) => Math.max(max, floorId(el)), -1);
    };
    const updateMessageBookmarkButton = (button, id) => {
      const saved = isBookmarked(id);
      button.classList.toggle("fa-solid", saved);
      button.classList.toggle("fa-regular", !saved);
      button.classList.toggle("meow-bookmarked", saved);
      button.style.color = saved ? "var(--SmartThemeQuoteColor, #d8a13b)" : "";
      button.title = saved ? "取消收藏" : "收藏此楼";
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", String(saved));
    };
    const syncMessageBookmarkButton = (message) => {
      const menu2 = message?.querySelector(".extraMesButtons");
      const id = Number(message?.getAttribute("mesid"));
      if (!menu2 || !Number.isSafeInteger(id) || id < 0) return;
      let button = menu2.querySelector(".meow-message-bookmark-action");
      if (!button) {
        button = doc.createElement("div");
        button.className = "mes_button meow-message-bookmark-action fa-regular fa-bookmark";
        button.setAttribute("role", "button");
        button.setAttribute("tabindex", "0");
        menu2.prepend(button);
      }
      updateMessageBookmarkButton(button, id);
    };
    const syncMessageBookmarkButtons = (root = chat) => {
      if (!root) return;
      if (root.matches?.(".mes[mesid]")) syncMessageBookmarkButton(root);
      root.querySelectorAll(".mes[mesid]").forEach(syncMessageBookmarkButton);
    };
    const update = () => {
      if (disposed) return;
      const ctx = context(), nextKey = chatKey(ctx);
      if (nextKey !== identity) {
        identity = nextKey;
        loadBookmarks(identity);
        syncMessageBookmarkButtons();
        history = [];
        generation++;
        messageAccess.clear();
        renderCache.clear();
        archiveRows = [];
        ui.status.textContent = "";
        hideReader();
      }
      const el = readerState ? null : currentFloor(), id = readerState ? readerState.id : el ? floorId(el) : null, last = lastId();
      observedLast = last;
      const setText = (el2, value) => {
        if (el2.textContent !== value) el2.textContent = value;
      };
      setText(ui.floor, id === null ? "—" : `${id} 楼`);
      setText(
        ui.location,
        last < 0 ? "暂无聊天" : `${readerState ? "正在阅读" : "当前"} ${id === null ? "—" : id} 楼 · 共 ${last + 1} 层`
      );
      ui.up.disabled = ui.down.disabled = ui.panelUp.disabled = ui.panelDown.disabled = busy || archiveMode || !(el || readerState);
      ui.go.disabled = busy || last < 0;
      ui.view.disabled = ui.swipes.disabled = busy || last < 0;
      ui.viewBookmarks.disabled = busy || last < 0;
      ui.back.disabled = ui.return.disabled = busy || !history.length;
      setText(ui.return.querySelector("span"), history.length ? `返回 ${history.at(-1).id} 楼` : "返回");
      if (ui.panel.getAttribute("aria-busy") !== String(busy)) ui.panel.setAttribute("aria-busy", String(busy));
      reader.previous.disabled = busy || archiveMode || !readerState || findNeighborId(readerState.id, -1) === null;
      reader.next.disabled = busy || archiveMode || !readerState || findNeighborId(readerState.id, 1) === null;
      reader.bookmark.disabled = busy || archiveMode || !readerState;
      reader.bookmark.setAttribute("aria-pressed", String(!!readerState && isBookmarked(readerState.id)));
      reader.bookmark.textContent = readerState && isBookmarked(readerState.id) ? "★ 已收藏" : "☆ 收藏";
      reader.bookmarkTitle.disabled = busy || archiveMode || !readerState;
      reader.bookmarks.disabled = busy || archiveMode || !readerState;
      const titleFloor = readerState?.id ?? null;
      if (titleFloor !== bookmarkTitleFloor) {
        bookmarkTitleFloor = titleFloor;
        reader.bookmarkTitle.value = titleFloor === null ? "" : getBookmarkTitle(titleFloor);
      } else if (readerState && shadow.activeElement !== reader.bookmarkTitle) {
        const savedTitle = isBookmarked(readerState.id) ? getBookmarkTitle(readerState.id) : "";
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
            messages = chat ? [...chat.querySelectorAll(".mes[mesid]")].filter((el) => /^\d+$/.test(el.getAttribute("mesid"))) : [];
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
          mode: "reader",
          swipeId: readerState.swipeId,
          raw: readerState.raw,
          offset: readerDocument()?.scrollingElement?.scrollTop ?? 0,
          message: context()?.chat?.[readerState.id],
          key: identity
        };
      const el = currentFloor();
      if (!el) return null;
      const id = floorId(el);
      return { id, mode: "chat", offset: chat.scrollTop - contentTop2(el), message: context()?.chat?.[id], key: identity };
    };
    const saveHistory = (entry) => {
      if (entry) {
        history.push(entry);
        if (history.length > 30) history.shift();
      }
    };
    const closePanel = (focus = false) => {
      ui.panel.hidden = true;
      ui.wrap.classList.add("shelved");
      ui.wrap.classList.remove("panel-open");
      ui.wrap.classList.remove("rail-expanded");
      reader.panel.inert = false;
      ui.rail.inert = viewportBounds(page).width <= 600;
      ui.dockHandle.inert = !reader.panel.hidden;
      ui.dockHandle.setAttribute("aria-expanded", "false");
      ui.dockHandle.setAttribute("aria-label", "展开侧边按钮");
      ui.dockHandle.title = "展开侧边按钮";
      ui.bird.setAttribute("aria-expanded", "false");
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
      ui.wrap.classList.remove("shelved");
      ui.wrap.classList.add("panel-open");
      ui.wrap.classList.remove("rail-expanded");
      reader.panel.inert = true;
      ui.rail.inert = true;
      ui.dockHandle.inert = true;
      reader.settings.open = false;
      ui.toast.hidden = true;
      ui.status.textContent = "";
      ui.bird.setAttribute("aria-expanded", "true");
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
      ui.wrap.classList.toggle("mobile", mobile);
      if (!mobile) ui.wrap.classList.remove("rail-expanded");
      const overlayOpen = !ui.panel.hidden || !reader.panel.hidden;
      ui.wrap.classList.toggle("panel-open", overlayOpen);
      const railExpanded = mobile && ui.wrap.classList.contains("rail-expanded") && !overlayOpen;
      ui.rail.inert = mobile && !railExpanded || overlayOpen;
      ui.dockHandle.hidden = !mobile;
      ui.dockHandle.inert = !mobile || overlayOpen;
      ui.dockHandle.setAttribute("aria-expanded", String(railExpanded));
      ui.dockHandle.setAttribute("aria-label", railExpanded ? "收起侧边按钮" : "展开侧边按钮");
      ui.dockHandle.title = railExpanded ? "收起侧边按钮" : "展开侧边按钮";
      ui.wrap.classList.toggle("shelved", ui.panel.hidden);
      ui.wrap.classList.toggle("compact", compact);
      ui.wrap.classList.toggle("short", bounds.height < 450);
      const height = $2(".rail").offsetHeight;
      const width = bounds.width, winHeight = bounds.height;
      const x = Number.isFinite(position?.x) ? position.x * width : width - 74;
      const y = Number.isFinite(position?.y) ? position.y * winHeight : winHeight * 0.42;
      const dockWidth = 48;
      const left = bounds.x + (mobile ? width - dockWidth : Math.max(8, Math.min(width - 66, x)));
      const top = bounds.y + Math.max(8, Math.min(Math.max(8, winHeight - height - 12), y));
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
      host.style.right = "auto";
      const onLeft = left - bounds.x < width / 2;
      ui.wrap.classList.toggle("left", onLeft);
      $2(".bottom").hidden = mobile;
      if (mobile) {
        ui.panel.style.left = `${bounds.x}px`;
        ui.panel.style.top = `${bounds.y}px`;
        ui.panel.style.width = `${width}px`;
        ui.panel.style.height = `${winHeight}px`;
        ui.panel.style.maxHeight = "none";
      } else {
        const panelWidth = Math.min(360, width - 32);
        ui.panel.style.width = `${panelWidth}px`;
        ui.panel.style.height = "auto";
        ui.panel.style.maxHeight = `${winHeight - 32}px`;
        const panelLeft = onLeft ? left + 70 : left - panelWidth - 12;
        ui.panel.style.left = `${Math.max(bounds.x + 16, Math.min(bounds.x + width - panelWidth - 16, panelLeft))}px`;
        ui.panel.style.top = `${Math.max(bounds.y + 16, Math.min(top, bounds.y + winHeight - ui.panel.offsetHeight - 16))}px`;
      }
      const toastWidth = ui.toast.offsetWidth || 220;
      ui.toast.style.left = `${Math.max(8, Math.min(width - toastWidth - 8, onLeft ? left + 70 : left - toastWidth - 12)) - left}px`;
      ui.toast.style.right = "auto";
      ui.side.textContent = onLeft ? "移到右侧" : "移到左侧";
      if (readerState || archiveMode) {
        const readerWidth = mobile ? width : Math.min(1040, width - 64);
        const readerHeight = mobile ? winHeight : Math.min(900, winHeight - 64);
        reader.panel.style.left = `${bounds.x + (width - readerWidth) / 2}px`;
        reader.panel.style.top = `${bounds.y + (winHeight - readerHeight) / 2}px`;
        reader.panel.style.width = `${readerWidth}px`;
        reader.panel.style.height = `${readerHeight}px`;
        const inside = readerDocument();
        const actions = $2(".reader-actions");
        $2(".reader-options").style.setProperty(
          "--settings-room",
          `${Math.max(44, reader.panel.clientHeight - actions.offsetTop - actions.offsetHeight - 14)}px`
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
      }
    };
    const scrollTo = (top) => {
      if (typeof page.jQuery === "function") page.jQuery(chat).stop(true);
      chat.scrollTo({ top: Math.max(0, Math.min(chat.scrollHeight - chat.clientHeight, top)), behavior: "instant" });
      schedule();
    };
    const flash = (el) => {
      clearHighlight();
      const value = el.style.getPropertyValue("outline"), priority = el.style.getPropertyPriority("outline");
      el.style.setProperty("outline", "2px solid #83b3a2", "important");
      highlighted = { el, value, priority };
      highlightTimer = page.setTimeout(clearHighlight, 1100);
    };
    function clearHighlight() {
      if (highlighted) {
        const { el, value, priority } = highlighted;
        if (value) el.style.setProperty("outline", value, priority);
        else el.style.removeProperty("outline");
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
      const state = (generating ? " · 生成中" : "") + (message.cached ? " · 缓存" : swipeId === message.swipe_id ? " · 已选" : "");
      const count = `${swipeId + 1} / ${message.swipes.length}${state}`;
      if (reader.swipeCount.textContent !== count) reader.swipeCount.textContent = count;
      reader.raw.setAttribute("aria-pressed", String(readerState.raw));
      reader.raw.textContent = readerState.raw ? "预览" : "原文";
    }
    const messageRenderer = createMessageRenderer({ page, doc, host, reader, context, lastId });
    const renderReaderContent = (id, message) => messageRenderer.renderContent(id, message);
    const extractBody = (text) => messageRenderer.extractBody(text);
    applyTheme();
    const showReader = (id, message, offset = 0, options = {}) => {
      const swipeId = Math.max(
        0,
        Math.min(
          message.swipes.length - 1,
          options.swipeId ?? (readerState?.id === id ? readerState.swipeId : message.swipe_id)
        )
      );
      const raw = options.raw ?? (readerState?.id === id ? readerState.raw : false);
      const text = message.swipes[swipeId] ?? "";
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
        reader.ignoreDepth.checked ? 0 : lastId()
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
          template = doc.createElement("template");
          const pre = doc.createElement("pre");
          pre.textContent = text || "（此回复暂为空）";
          template.content.appendChild(pre);
        } else template = renderReaderContent(id, { ...message, mes: extractBody(text) || "（此回复暂为空）" });
        messageRenderer.sanitizeContent(template.content);
        messageRenderer.prepareDocuments(template.content);
        bodyHtml = template.innerHTML;
        renderCache.set(cacheKey, { text, html: bodyHtml });
        let size = [...renderCache.values()].reduce((sum, value) => sum + value.text.length + value.html.length, 0);
        while (renderCache.size > 6 || size > 2e6) {
          const key = renderCache.keys().next().value, value = renderCache.get(key);
          size -= value.text.length + value.html.length;
          renderCache.delete(key);
        }
      }
      const body = doc.createElement("body");
      body.classList.add("mes_text");
      body.innerHTML = bodyHtml;
      const wrapperStyle = doc.createElement("style");
      wrapperStyle.textContent = "content,meow_fm,snow{display:block}";
      body.prepend(wrapperStyle);
      messageRenderer.unmountDocuments();
      const load = ++readerLoad;
      readerState = { id, message, swipeId, raw, text };
      archiveMode = false;
      archive.panel.hidden = true;
      reader.frame.hidden = false;
      $2(".reader-swipes").hidden = $2(".reader-actions").hidden = false;
      $2(".reader-auto").hidden = false;
      reader.panel.hidden = reader.mask.hidden = false;
      reader.title.textContent = `第 ${id} 楼${message.name ? ` · ${message.name}` : ""}`;
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
          }
        });
        inside.scrollingElement.scrollTop = offset;
        inside.addEventListener("pointerdown", autoReader.pause, { passive: true });
        inside.addEventListener("wheel", autoReader.pause, { passive: true });
        inside.addEventListener("keydown", (event) => {
          if ([" ", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) autoReader.pause();
        });
        inside.addEventListener("click", (event) => {
          reader.settings.open = false;
          if (event.composedPath().some((el) => el.tagName === "A")) event.preventDefault();
        });
        inside.addEventListener("keydown", (event) => {
          if (event.key === "Escape") {
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
      if (disposed || token !== generation) throw new Error("聊天已切换，本次跳转已取消。");
      let el = !preferReader && floorElement(id);
      const virtual = page.__TAURITAVERN__?.api?.chatSurface?.isManagedOwnershipRequired?.() === true;
      if (!el && !preferReader && virtual) {
        const helper = page.TavernHelper;
        const jump = typeof triggerSlash === "function" ? triggerSlash : helper?.triggerSlash?.bind(helper);
        if (jump) {
          await jump(`/chat-jump ${id}`);
          el = floorElement(id);
        }
      }
      if (disposed || token !== generation) throw new Error("聊天已切换，本次跳转已取消。");
      if (el) {
        if (!el.getClientRects().length || el.getBoundingClientRect().height <= 0)
          throw new Error(`${id} 楼当前被隐藏，请先在酒馆中显示该楼层。`);
        hideReader();
        closePanel(true);
        scrollTo(contentTop2(el) + offset);
        flash(el);
        return;
      }
      showReader(id, readMessage(id), preferReader ? offset : 0, options);
    };
    const runNavigation = async (action) => {
      if (busy || disposed) return;
      update();
      const token = generation;
      busy = true;
      update();
      try {
        await action(token);
      } catch (error) {
        if (!disposed) showStatus(error.message || "跳转失败，请重试。");
      } finally {
        busy = false;
        if (!disposed) {
          schedule();
          update();
          place();
        }
      }
    };
    const go = () => runNavigation(async (token) => {
      const raw = ui.input.value.trim().replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 65248));
      const match = /^(?:第\s*)?(\d+)\s*(?:楼|层)?$/.exec(raw);
      const id = match ? Number(match[1]) : NaN;
      if (!Number.isSafeInteger(id) || id < 0 || id > lastId()) {
        ui.input.setAttribute("aria-invalid", "true");
        showStatus(`请输入 0～${Math.max(0, lastId())} 之间的楼层号。`);
        ui.input.focus({ preventScroll: true });
        return;
      }
      ui.input.removeAttribute("aria-invalid");
      const before = snapshot();
      showStatus(`正在前往 ${id} 楼…`);
      await goTo(id, token);
      if (disposed || token !== generation) return;
      saveHistory(before);
      showStatus(`已到 ${id} 楼`);
    });
    const back = () => runNavigation(async (token) => {
      const entry = history.at(-1);
      if (!entry || entry.key !== identity) return;
      let id = entry.id;
      if (entry.message) {
        id = context()?.chat?.indexOf(entry.message) ?? -1;
        if (id < 0) {
          history.pop();
          throw new Error("原来的楼层已被删除，无法恢复该位置。");
        }
      }
      showStatus(`正在返回 ${id} 楼…`);
      await goTo(id, token, entry.mode === "reader", entry.offset, { swipeId: entry.swipeId, raw: entry.raw });
      if (disposed || token !== generation) return;
      history.pop();
    });
    const edge = (bottom) => {
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
        showStatus("请先打开一个聊天。");
        return;
      }
      const before = snapshot();
      const top = contentTop2(el) + (bottom ? Math.max(0, el.getBoundingClientRect().height - chat.clientHeight) : 0);
      if (Math.abs(chat.scrollTop - Math.max(0, Math.min(chat.scrollHeight - chat.clientHeight, top))) < 2) return;
      saveHistory(before);
      scrollTo(top);
      update();
    };
    listen(ui.bird, "click", () => {
      togglePanel();
    });
    listen(ui.dockHandle, "click", () => {
      if (!ui.panel.hidden) return;
      const expanded = !ui.wrap.classList.contains("rail-expanded");
      ui.wrap.classList.toggle("rail-expanded", expanded);
      ui.rail.inert = !expanded;
      ui.dockHandle.setAttribute("aria-expanded", String(expanded));
      ui.dockHandle.setAttribute("aria-label", expanded ? "收起侧边按钮" : "展开侧边按钮");
      ui.dockHandle.title = expanded ? "收起侧边按钮" : "展开侧边按钮";
    });
    listen(ui.up, "click", () => edge(false));
    listen(ui.down, "click", () => edge(true));
    listen(ui.panelUp, "click", () => {
      closePanel(true);
      edge(false);
    });
    listen(ui.panelDown, "click", () => {
      closePanel(true);
      edge(true);
    });
    listen(ui.back, "click", back);
    listen(ui.return, "click", back);
    const readerNeighbor = (delta) => runNavigation(async (token) => {
      if (!readerState) return;
      const before = snapshot(), id = findNeighborId(readerState.id, delta);
      if (id === null) return;
      await goTo(id, token, true);
      saveHistory(before);
    });
    const exitReader = () => {
      if (busy) return;
      while (history.at(-1)?.mode === "reader") history.pop();
      if (history.length) back();
      else {
        hideReader();
        update();
        place();
      }
      ui.bird.focus({ preventScroll: true });
    };
    listen(reader.previous, "click", () => readerNeighbor(-1));
    listen(reader.next, "click", () => readerNeighbor(1));
    listen(reader.exit, "click", exitReader);
    listen(reader.mask, "click", exitReader);
    const changeReaderSettings = () => runNavigation(async (token) => {
      if (readerState && !archiveMode)
        await goTo(readerState.id, token, true, readerDocument()?.scrollingElement?.scrollTop ?? 0);
    });
    for (const field of [reader.ignoreDepth, reader.bodyOnly, reader.skipBookmarks, reader.start, reader.end])
      listen(field, "change", changeReaderSettings);
    listen(reader.bookmark, "click", () => {
      if (!readerState || archiveMode) return;
      const id = readerState.id;
      if (isBookmarked(id)) bookmarkedIds.delete(id);
      else bookmarkedIds.set(id, reader.bookmarkTitle.value.trim());
      saveBookmarks();
      syncMessageBookmarkButton(floorElement(id));
      update();
    });
    listen(reader.bookmarkTitle, "input", () => {
      if (!readerState || !isBookmarked(readerState.id)) return;
      bookmarkedIds.set(readerState.id, reader.bookmarkTitle.value.trim());
      saveBookmarks();
    });
    listen(doc, "click", (event) => {
      const action = event.target?.closest?.(".meow-message-bookmark-action");
      if (!action || !chat?.contains(action)) return;
      event.preventDefault();
      event.stopPropagation();
      const message = action.closest(".mes[mesid]");
      const id = Number(message?.getAttribute("mesid"));
      if (!Number.isSafeInteger(id) || id < 0) return;
      if (isBookmarked(id)) bookmarkedIds.delete(id);
      else bookmarkedIds.set(id, "");
      saveBookmarks();
      updateMessageBookmarkButton(action, id);
      update();
      showStatus(isBookmarked(id) ? `已收藏第 ${id} 楼，可在喵喵助手的收藏夹中添加备注。` : `已取消第 ${id} 楼的收藏。`);
    });
    listen(doc, "keydown", (event) => {
      const action = event.target?.closest?.(".meow-message-bookmark-action");
      if (!action || event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      action.click();
    });
    const chooseSwipe = (value) => runNavigation(async (token) => {
      if (!readerState || archiveMode) return;
      const before = snapshot();
      await goTo(readerState.id, token, true, 0, { swipeId: value, raw: readerState.raw });
      saveHistory(before);
    });
    listen(reader.swipePrevious, "click", () => chooseSwipe(readerState.swipeId - 1));
    listen(reader.swipeNext, "click", () => chooseSwipe(readerState.swipeId + 1));
    listen(reader.swipeCurrent, "click", () => chooseSwipe(readMessage(readerState.id).swipe_id));
    listen(
      reader.raw,
      "click",
      () => runNavigation(async (token) => {
        if (readerState) await goTo(readerState.id, token, true, 0, { raw: !readerState.raw });
      })
    );
    const refreshReader = () => {
      if (busy || disposed || !readerState || archiveMode) return;
      try {
        const message = readMessage(readerState.id);
        const swipeId = Math.min(readerState.swipeId, message.swipes.length - 1);
        if (message.swipes[swipeId] !== readerState.text)
          showReader(readerState.id, message, readerDocument()?.scrollingElement?.scrollTop ?? 0, {
            swipeId,
            focus: false
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
        generating ? 400 : 120
      );
    };
    listen(
      reader.refresh,
      "click",
      () => runNavigation(async (token) => {
        if (!readerState || archiveMode) return;
        renderCache.clear();
        await goTo(readerState.id, token, true, readerDocument()?.scrollingElement?.scrollTop ?? 0, { focus: false });
      })
    );
    const openMessage = (previous = false, latest = false) => runNavigation(async (token) => {
      const visible = readerState?.id ?? (currentFloor() ? floorId(currentFloor()) : lastId());
      const id = previous || latest ? nearestAssistant(generating || latest ? lastId() : visible) : visible;
      if (id === null || id < 0) throw new Error("当前没有可查看的消息。");
      const before = snapshot(), message = readMessage(id);
      const options = previous ? { swipeId: Math.max(0, message.swipe_id - 1), raw: false } : { raw: false };
      await goTo(id, token, true, 0, options);
      saveHistory(before);
    });
    listen(ui.view, "click", () => openMessage());
    listen(ui.swipes, "click", () => openMessage(true));
    listen(reader.latest, "click", () => openMessage(false, true));
    const renderArchive = () => {
      const result = collectionMode === "bookmarks" ? renderBookmarkPage(doc, archive, bookmarkRows, archivePage, archive.search.value) : renderArchivePage(
        doc,
        archive,
        archiveRows,
        archivePage,
        archive.search.value,
        archive.hideBookmarks.checked,
        isBookmarked
      );
      archivePage = result.page;
    };
    const openCollection = (mode) => {
      if (busy) return;
      autoReader.pause();
      $2(".reader-auto").hidden = true;
      update();
      collectionMode = mode;
      if (mode === "bookmarks") {
        bookmarkRows = [...bookmarkedIds.entries()].sort(([a], [b]) => a - b).map(([id, title]) => {
          try {
            const message = readMessage(id);
            const text = String(message.swipes?.[message.swipe_id] ?? message.mes ?? "");
            return {
              id,
              title,
              role: message.is_user ? "用户" : message.is_system || message.extra?.type === "narrator" ? "系统" : "助手",
              preview: messagePreview(text)
            };
          } catch (_) {
            return { id, title, role: "消息暂不可读", preview: "" };
          }
        });
        archive.hideBookmarks.closest("label").hidden = true;
        archive.search.placeholder = "搜索备注标题、楼层或内容";
      } else {
        archiveRows = collectArchiveRows(context()?.chat, page, lastId());
        archive.hideBookmarks.closest("label").hidden = false;
        archive.search.placeholder = "搜索楼层、角色或内容";
      }
      if (!readerState && !archiveMode) saveHistory(snapshot());
      archiveMode = true;
      archivePage = 0;
      archive.search.value = "";
      reader.panel.hidden = reader.mask.hidden = false;
      archive.panel.hidden = false;
      reader.frame.hidden = true;
      $2(".reader-swipes").hidden = $2(".reader-actions").hidden = true;
      reader.title.textContent = mode === "bookmarks" ? "收藏夹" : "回复目录";
      closePanel();
      renderArchive();
      update();
      place();
      archive.search.focus({ preventScroll: true });
    };
    const openArchive = () => openCollection("replies");
    const openBookmarks = () => openCollection("bookmarks");
    listen($2(".view-archive"), "click", openArchive);
    listen($2(".reader-archive"), "click", openArchive);
    listen(reader.bookmarks, "click", openBookmarks);
    listen(ui.viewBookmarks, "click", openBookmarks);
    listen(archive.search, "input", () => {
      page.clearTimeout(searchTimer);
      searchTimer = page.setTimeout(() => {
        archivePage = 0;
        renderArchive();
      }, 150);
    });
    listen(archive.hideBookmarks, "change", () => {
      archivePage = 0;
      renderArchive();
    });
    listen(archive.previous, "click", () => {
      archivePage--;
      renderArchive();
    });
    listen(archive.next, "click", () => {
      archivePage++;
      renderArchive();
    });
    listen(archive.list, "click", (event) => {
      const card = event.target.closest(".history-card");
      if (!card) return;
      runNavigation(async (token) => {
        const before = readerState ? snapshot() : null;
        await goTo(Number(card.dataset.floor), token, true, 0, { raw: false });
        saveHistory(before);
      });
    });
    const menu = doc.querySelector("#extensionsMenu");
    if (menu) {
      const item = doc.createElement("div");
      item.id = "bird-message-history-menu";
      item.className = "extension_container interactable";
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "list-group-item flex-container flexGap5 interactable";
      button.textContent = "喵喵回复目录";
      item.appendChild(button);
      menu.appendChild(item);
      listen(button, "click", openArchive);
      cleanups.push(() => item.remove());
    }
    listen($2("form"), "submit", (event) => {
      event.preventDefault();
      go();
    });
    listen(ui.input, "input", () => ui.input.removeAttribute("aria-invalid"));
    listen($2(".close"), "click", () => closePanel(true));
    listen(ui.side, "click", () => {
      position = {
        x: ui.wrap.classList.contains("left") ? 1 : 0,
        y: host.getBoundingClientRect().top / page.innerHeight
      };
      place();
      persistPosition();
    });
    function closeSettings() {
      reader.settings.open = false;
      reader.settings.querySelector("summary").focus({ preventScroll: true });
    }
    listen(doc, "pointerdown", (event) => {
      const path = event.composedPath();
      if (reader.settings.open && !path.includes(reader.settings)) reader.settings.open = false;
      if (!path.includes(host)) {
        if (!ui.panel.hidden) closePanel();
        if (ui.wrap.classList.contains("rail-expanded")) {
          ui.wrap.classList.remove("rail-expanded");
          place();
        }
      }
      if (!path.some((el) => el instanceof page.Element && (el.classList.contains("auto-controls") || el.classList.contains("auto-float")))) autoReader.pause();
    }, { capture: true, passive: true });
    listen(doc, "wheel", autoReader.pause, { passive: true });
    listen(doc, "visibilitychange", () => {
      if (doc.hidden) autoReader.pause();
    });
    listen(page, "blur", () => {
      autoReader.pause();
      page.setTimeout(() => {
        if (doc.activeElement?.tagName === "IFRAME" && !host.contains(doc.activeElement)) {
          ui.wrap.classList.remove("rail-expanded");
          requestPlace();
        }
      }, 0);
    });
    shadow.querySelectorAll(".auto-toggle").forEach((button) => listen(button, "click", () => {
      if (autoReader.running) {
        autoReader.pause();
        return;
      }
      if (archiveMode) return;
      closePanel();
      autoReader.start();
    }));
    shadow.querySelectorAll(".auto-speed").forEach((select) => {
      select.value = String(autoReader.speed);
      listen(select, "change", () => autoReader.setSpeed(Number(select.value)));
    });
    shadow.querySelectorAll(".auto-continue").forEach((input) => listen(input, "change", () => {
      continueReading = input.checked;
      shadow.querySelectorAll(".auto-continue").forEach((other) => other.checked = continueReading);
    }));
    listen($2(".auto-float"), "click", autoReader.pause);
    listen(doc, "keydown", (event) => {
      if (event.key === "Escape" || [" ", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key) && !event.composedPath().some((el) => el instanceof page.Element && el.classList.contains("auto-controls"))) autoReader.pause();
      if (event.key === "Tab" && !ui.panel.hidden) {
        const controls = [...ui.panel.querySelectorAll("button:not(:disabled),input:not(:disabled)")].filter(
          (el) => el.getClientRects().length
        );
        const first = controls[0], last = controls.at(-1), active = shadow.activeElement;
        if (controls.length && (!ui.panel.contains(active) || active === ui.panel || (event.shiftKey ? active === first : active === last))) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus({ preventScroll: true });
        }
      }
      if (event.key === "Escape") {
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
      controls: [ui.bird, ui.dockHandle],
      host,
      enabled: () => !busy && ui.panel.hidden && reader.panel.hidden,
      onMove: (dx, dy, origin) => {
        const bounds = viewportBounds(page);
        position = { x: (origin.left + dx - bounds.x) / bounds.width, y: (origin.top + dy - bounds.y) / bounds.height };
        requestPlace();
      },
      onEnd: () => {
        place();
        persistPosition();
      }
    }));
    listen(page, "resize", () => {
      requestPlace();
      schedule();
    });
    if (page.visualViewport) {
      listen(page.visualViewport, "resize", requestPlace);
      listen(page.visualViewport, "scroll", requestPlace);
    }
    let chatObserver = null;
    const bindChat = () => {
      const next = doc.querySelector("#chat");
      if (next === chat) return;
      if (chat) chat.removeEventListener("scroll", schedule);
      chatObserver?.disconnect();
      chat = next;
      generation++;
      history = [];
      messageAccess.clear();
      renderCache.clear();
      archiveRows = [];
      hideReader();
      if (chat) {
        chat.addEventListener("scroll", schedule, { passive: true });
        chatObserver = new page.MutationObserver((records) => {
          for (const record of records)
            for (const node of record.addedNodes)
              if (node.nodeType === 1) syncMessageBookmarkButtons(node);
          scan();
        });
        chatObserver.observe(chat, { childList: true });
      }
      scan();
    };
    const interval = page.setInterval(() => {
      bindChat();
      if (chatKey(context()) !== identity || lastId() !== observedLast) schedule();
      if (generating && readerState && !archiveMode) scheduleRefresh();
    }, 1e3);
    for (const name of ["MESSAGE_RECEIVED", "MESSAGE_DELETED", "USER_MESSAGE_RENDERED", "CHARACTER_MESSAGE_RENDERED"]) {
      if (typeof eventOn === "function" && typeof tavern_events !== "undefined" && tavern_events[name]) {
        const subscription = eventOn(tavern_events[name], scan);
        cleanups.push(() => subscription.stop());
      }
    }
    if (typeof eventOn === "function" && typeof tavern_events !== "undefined") {
      const onChanged = eventOn(tavern_events.CHAT_CHANGED, () => {
        generation++;
        history = [];
        messageAccess.clear();
        renderCache.clear();
        archiveRows = [];
        generating = false;
        ui.status.textContent = "";
        hideReader();
        bindChat();
        scan();
      });
      cleanups.push(() => onChanged.stop());
      if (tavern_events.SETTINGS_UPDATED) {
        const sub = eventOn(tavern_events.SETTINGS_UPDATED, () => renderCache.clear());
        cleanups.push(() => sub.stop());
      }
      for (const name of ["MESSAGE_SWIPED", "MESSAGE_UPDATED", "CHARACTER_MESSAGE_RENDERED", "MESSAGE_SWIPE_DELETED"]) {
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
          }
          updateSwipeControls();
          scheduleRefresh();
        });
        cleanups.push(() => sub.stop());
      }
      for (const name of ["GENERATION_ENDED", "GENERATION_STOPPED"]) {
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
      chat?.removeEventListener("scroll", schedule);
      chatObserver?.disconnect();
      cleanups.forEach((fn) => fn());
      host.remove();
      if (page[KEY]?.destroy === destroy) delete page[KEY];
    };
    page[KEY] = { destroy };
    listen(window, "pagehide", destroy, { once: true });
    bindChat();
    identity = chatKey(context());
    update();
    place();
  }

  // script-metadata.ts
  function syncScriptMetadata() {
    try {
      if (typeof getScriptId !== "function") return;
      const helper = window.parent?.TavernHelper;
      const getTrees = typeof getScriptTrees === "function" ? getScriptTrees : helper?.getScriptTrees;
      const updateTrees = typeof updateScriptTreesWith === "function" ? updateScriptTreesWith : helper?.updateScriptTreesWith;
      if (!getTrees || !updateTrees) return;
      const id = getScriptId();
      const name = `喵喵消息助手 v${SCRIPT_VERSION}`;
      const find = (trees) => {
        for (const item of trees) {
          if (item.type === "script" && item.id === id) return item;
          if (item.type === "folder") {
            const found = find(item.scripts ?? []);
            if (found) return found;
          }
        }
        return null;
      };
      for (const type of ["global", "preset", "character"]) {
        const own = find(getTrees({ type }));
        if (!own) continue;
        if (own.name !== name && /^喵喵消息助手(?:\s+v[\d.]+)?$/.test(own.name)) {
          updateTrees((trees) => {
            const current = find(trees);
            if (current) current.name = name;
            return trees;
          }, { type });
        }
        return;
      }
    } catch (error) {
      console.warn("[喵喵消息助手] 列表版本名称同步失败", error);
    }
  }

  // index.ts
  $(() => {
    errorCatched(startAssistant)();
    syncScriptMetadata();
  });
})();
