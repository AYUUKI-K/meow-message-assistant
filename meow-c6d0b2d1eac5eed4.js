(() => {
  // archive.ts
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
  function renderArchivePage(doc, archive, rows, requestedPage, keyword) {
    const normalized = keyword.trim().toLocaleLowerCase();
    const filtered = rows.filter(
      (row) => !normalized || `${row.id} ${row.name} ${row.role}`.toLocaleLowerCase().includes(normalized) || row.swipes.some((text) => text.toLocaleLowerCase().includes(normalized))
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
      title.textContent = `${row.id} 楼 · ${row.name || row.role}`;
      const meta = doc.createElement("span");
      meta.textContent = `${row.role} · ${row.swipes.length} 个版本`;
      const preview = doc.createElement("p");
      preview.textContent = (row.swipes[row.current] || row.swipes[0] || "").slice(0, 4e3).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
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
  var assistant_default = ":host {\n  all: initial;\n  position: fixed;\n  right: max(16px, env(safe-area-inset-right));\n  top: 42%;\n  z-index: 2147483000;\n  font-family:\n    system-ui,\n    -apple-system,\n    'Microsoft YaHei',\n    sans-serif;\n  color: #304d47;\n  color-scheme: light;\n}\n*,\n*::before,\n*::after {\n  box-sizing: border-box;\n}\n.wrap {\n  position: relative;\n}\nbutton,\ninput {\n  font: inherit;\n}\nbutton {\n  cursor: pointer;\n  touch-action: manipulation;\n}\nbutton:disabled {\n  cursor: default;\n  opacity: 0.42;\n}\nsvg {\n  display: block;\n  width: 22px;\n  height: 22px;\n  pointer-events: none;\n}\n.rail {\n  width: 58px;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  padding: 5px;\n  gap: 4px;\n  background: var(--surface);\n  border: 1px solid var(--line);\n  border-radius: 32px;\n  box-shadow: 0 6px 24px #233c3329;\n}\n.dock-handle {\n  display: none;\n  position: absolute;\n  z-index: 5;\n  top: 0;\n  bottom: 0;\n  right: 0;\n  width: 28px;\n  height: auto;\n  margin: 0;\n  padding: 0;\n  border: 0;\n  border-radius: 0;\n  appearance: none;\n  background: transparent;\n  transform: none;\n  touch-action: manipulation;\n}\n.dock-handle::before {\n  content: '';\n  position: absolute;\n  top: 50%;\n  right: 0;\n  width: 4px;\n  height: 58px;\n  border-radius: 4px 0 0 4px;\n  background: var(--muted);\n  opacity: 0.7;\n  transform: translateY(-50%);\n  pointer-events: none;\n  transition:\n    width 160ms,\n    opacity 160ms;\n}\n.dock-handle:active::before {\n  width: 7px;\n  opacity: 1;\n}\n.rail button {\n  display: grid;\n  place-items: center;\n  width: 46px;\n  height: 44px;\n  padding: 0;\n  color: var(--ink);\n  border: 0;\n  border-radius: 24px;\n  background: transparent;\n  transition:\n    background 150ms,\n    transform 150ms;\n}\n.rail button:hover:not(:disabled) {\n  background: var(--accent);\n}\n/* The edge handle's hit area must stay still while a pointer is pressed. */\nbutton:active:not(:disabled):not(.dock-handle) {\n  transform: scale(0.94);\n}\n.rail .bird {\n  height: 54px;\n  background: var(--accent);\n  touch-action: none;\n  user-select: none;\n}\n.bird svg {\n  width: 48px;\n  height: 48px;\n}\n.floor {\n  font-size: 11px;\n  line-height: 18px;\n  color: var(--muted);\n  font-variant-numeric: tabular-nums;\n  max-width: 48px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.rail .back {\n  border-top: 1px solid var(--line);\n  border-radius: 8px 8px 22px 22px;\n}\n.panel {\n  position: fixed;\n  display: flex;\n  flex-direction: column;\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  padding: clamp(18px, 4vw, 48px);\n  background: var(--surface);\n  border: 0;\n  border-radius: 0;\n}\n.wrap.panel-open .rail {\n  visibility: hidden;\n}\n.wrap.panel-open .dock-handle {\n  visibility: hidden;\n  pointer-events: none;\n}\n[hidden] {\n  display: none !important;\n}\n.heading {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  margin-bottom: 18px;\n}\nh2 {\n  font-size: 18px;\n  letter-spacing: 0.03em;\n  margin: 0;\n  font-weight: 650;\n}\n.close {\n  display: grid;\n  place-items: center;\n  width: 44px;\n  height: 44px;\n  margin: -10px -10px -10px 0;\n  border: 0;\n  border-radius: 14px;\n  background: transparent;\n  color: var(--muted);\n}\n.close:hover {\n  background: var(--accent);\n}\n.location {\n  margin: 4px 0 0;\n  font-size: 12px;\n  line-height: 1.6;\n  color: var(--muted);\n}\nlabel {\n  display: block;\n  font-size: 13px;\n  margin-bottom: 8px;\n}\n.row {\n  display: flex;\n  gap: 8px;\n}\ninput {\n  width: 0;\n  min-width: 0;\n  flex: 1;\n  height: 46px;\n  padding: 0 12px;\n  color: var(--ink);\n  background: var(--control);\n  border: 1px solid var(--line);\n  border-radius: 12px;\n  font-size: 16px;\n}\n.go {\n  min-width: 64px;\n  height: 46px;\n  border: 1px solid var(--primary);\n  border-radius: 12px;\n  background: var(--primary);\n  color: var(--on-primary);\n  font-size: 14px;\n}\n.return {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n  width: 100%;\n  height: 44px;\n  background: var(--accent);\n  border: 1px solid var(--line);\n  border-radius: 12px;\n  color: var(--ink);\n  font-size: 13px;\n}\n.bottom {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  margin-top: 14px;\n}\n.side {\n  height: 44px;\n  padding: 0 10px;\n  border: 0;\n  border-radius: 10px;\n  background: transparent;\n  color: var(--ink);\n  font-size: 12px;\n  white-space: nowrap;\n}\n.side:hover {\n  background: var(--accent);\n}\n.status {\n  margin: 12px 0 0;\n  font-size: 12px;\n  line-height: 1.6;\n  overflow-wrap: anywhere;\n  color: var(--ink);\n}\n.status:empty {\n  display: none;\n}\n.toast {\n  position: absolute;\n  right: 70px;\n  top: 0;\n  width: 220px;\n  padding: 12px 16px;\n  border: 1px solid var(--line);\n  border-radius: 16px;\n  background: var(--surface);\n  box-shadow: 0 6px 24px #233c3329;\n  font-size: 13px;\n  line-height: 1.6;\n}\n.wrap.left .toast {\n  right: auto;\n  left: 70px;\n}\n.rail,\n.panel,\n.toast {\n  z-index: 3;\n}\n.rail {\n  position: relative;\n}\n.reader-mask {\n  position: fixed;\n  inset: 0;\n  background: #15202d66;\n  z-index: 1;\n}\n:host([data-theme='dark']) .reader-mask {\n  background: #0009;\n}\n.reader {\n  position: fixed;\n  display: flex;\n  flex-direction: column;\n  border: 0;\n  border-radius: 0;\n  overflow: hidden;\n  background: var(--surface);\n  z-index: 2;\n}\n.reader-head {\n  padding: 14px 18px;\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 8px;\n  border-bottom: 1px solid var(--line);\n}\n.reader-heading {\n  flex: 1;\n  min-width: 110px;\n}\n.reader-heading h2 {\n  font-size: 16px;\n}\n.reader-head button {\n  height: 44px;\n  min-width: 44px;\n  display: grid;\n  place-items: center;\n  border: 1px solid var(--line);\n  background: var(--accent);\n  color: var(--ink);\n  border-radius: 10px;\n  padding: 0 10px;\n  font-size: 13px;\n}\n.reader-frame {\n  display: block;\n  border: 0;\n  width: 100%;\n  flex: 1;\n  min-height: 0;\n  background: var(--surface);\n}\n.reader-options {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 0 18px;\n  min-height: 44px;\n  border-bottom: 1px solid var(--line);\n}\n.reader-options label {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-height: 44px;\n  margin: 0;\n  font-size: 12px;\n  cursor: pointer;\n}\n.reader-options input {\n  width: 18px;\n  height: 18px;\n  flex: none;\n  padding: 0;\n  margin: 0;\n  accent-color: #39776c;\n}\n.reader-options input:disabled {\n  opacity: 0.45;\n}\n@media (max-width: 480px) {\n  .reader-head {\n    padding: 10px;\n  }\n}\n.wrap {\n  --ink: #263e59;\n  --muted: #586f89;\n  --surface: #fff;\n  --control: #f7faff;\n  --line: #c5d4e6;\n  --accent: #e7eff9;\n  --primary: #386aab;\n  --on-primary: #fff;\n  --focus: #4b80c2;\n  --shadow: #17385d24;\n  --cat-face: #739ac0;\n  --cat-ear: #edf5ff;\n  --cat-line: #2d5275;\n  color: var(--ink);\n}\n:host([data-theme='dark']) .wrap {\n  --ink: #e4e7eb;\n  --muted: #a6adb7;\n  --surface: #181b20;\n  --control: #22262c;\n  --line: #464d58;\n  --accent: #303640;\n  --primary: #d1d7e0;\n  --on-primary: #1b1e23;\n  --focus: #adbdd2;\n  --shadow: #0007;\n  --cat-face: #a6b6cb;\n  --cat-ear: #222832;\n  --cat-line: #d1dbe6;\n  color-scheme: dark;\n}\n.rail,\n.panel,\n.reader,\n.toast {\n  box-shadow: 0 8px 28px var(--shadow);\n}\nbutton:focus-visible,\ninput:focus-visible,\nsummary:focus-visible {\n  outline: 3px solid var(--focus);\n  outline-offset: 2px;\n}\n.rail .bird {\n  background: var(--accent);\n}\n.rail .back {\n  border-color: var(--line);\n}\ninput {\n  color: var(--ink);\n  background: var(--control);\n  border-color: var(--line);\n}\n.go {\n  background: var(--primary);\n  border-color: var(--primary);\n  color: var(--on-primary);\n}\n.panel {\n  z-index: 6;\n  box-shadow: none;\n  padding-top: max(18px, env(safe-area-inset-top));\n  padding-bottom: max(18px, env(safe-area-inset-bottom));\n}\n.panel .heading {\n  flex: none;\n  margin: 0;\n}\n.panel .close {\n  margin: 0;\n}\n.panel-main {\n  width: min(620px, 100%);\n  margin: auto;\n  padding: 28px 0;\n}\n.panel-emblem {\n  display: grid;\n  place-items: center;\n  margin: 0 auto 28px;\n  width: 120px;\n  height: 120px;\n  border-radius: 50%;\n  background: var(--accent);\n}\n.panel-emblem svg {\n  width: 100px;\n  height: 100px;\n}\n.panel form > label {\n  font-size: 14px;\n  margin-bottom: 12px;\n}\n.panel .row input {\n  height: 64px;\n  font-size: 24px;\n  padding: 0 18px;\n  border-radius: 16px;\n}\n.panel .go {\n  height: 64px;\n  min-width: 88px;\n  font-size: 16px;\n  border-radius: 16px;\n}\n.panel-edges {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 12px;\n  margin: 16px 0;\n}\n.panel-edges button {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n  min-height: 52px;\n  padding: 10px;\n  border: 1px solid var(--line);\n  border-radius: 14px;\n  color: var(--ink);\n  background: var(--control);\n  font-size: 14px;\n}\n.panel .return {\n  height: 52px;\n  font-size: 14px;\n}\n.panel-actions {\n  display: grid;\n  grid-template-columns: 1fr 1fr 1fr;\n  gap: 12px;\n  margin: 16px 0;\n}\n.panel-actions button,\n.reader-actions button {\n  min-height: 44px;\n  padding: 0 12px;\n  border: 1px solid var(--line);\n  border-radius: 12px;\n  color: var(--ink);\n  background: var(--control);\n  font-size: 13px;\n}\n.bottom {\n  justify-content: flex-end;\n  margin-top: 6px;\n}\n.reader-head {\n  padding: 12px 16px;\n}\n.reader-heading {\n  min-width: 100px;\n}\n.reader-heading h2 {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.reader-swipes {\n  display: grid;\n  grid-template-columns: 44px minmax(0, 1fr) 44px auto;\n  align-items: center;\n  gap: 8px;\n  padding: 8px 16px;\n  border-bottom: 1px solid var(--line);\n}\n.reader-swipes button {\n  min-width: 44px;\n  height: 44px;\n  display: grid;\n  place-items: center;\n  padding: 0 10px;\n  border: 1px solid var(--line);\n  border-radius: 10px;\n  color: var(--ink);\n  background: var(--control);\n  font-size: 13px;\n}\n.swipe-count {\n  text-align: center;\n  font-size: 13px;\n  line-height: 1.4;\n  font-variant-numeric: tabular-nums;\n}\n.reader-actions {\n  position: relative;\n  flex: none;\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 8px;\n  padding: 0 16px 8px;\n  border-bottom: 1px solid var(--line);\n}\n.reader-actions button[aria-pressed='true'] {\n  background: var(--accent);\n  border-color: var(--primary);\n}\n.reader-settings {\n  min-width: 0;\n}\n.reader-settings summary {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  min-height: 44px;\n  padding: 0 12px;\n  border: 1px solid var(--line);\n  border-radius: 12px;\n  color: var(--ink);\n  background: var(--control);\n  font-size: 13px;\n  cursor: pointer;\n  list-style: none;\n}\n.reader-settings summary::-webkit-details-marker {\n  display: none;\n}\n.reader-settings[open] summary {\n  background: var(--accent);\n  border-color: var(--primary);\n}\n.reader-options {\n  position: absolute;\n  left: 12px;\n  top: calc(100% + 6px);\n  z-index: 4;\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);\n  width: min(460px, calc(100% - 24px));\n  gap: 8px 12px;\n  padding: 12px;\n  border: 1px solid var(--line);\n  border-radius: 14px;\n  background: var(--surface);\n  box-shadow: 0 8px 28px var(--shadow);\n  max-height: min(260px, 35dvh, var(--settings-room, 260px));\n  overflow: auto;\n  overscroll-behavior: contain;\n}\n.reader-options .tag-field {\n  display: block;\n  min-width: 0;\n  font-size: 12px;\n}\n.reader-options .tag-field span {\n  display: block;\n  margin-bottom: 4px;\n}\n.reader-options .tag-field input {\n  display: block;\n  width: 100%;\n  height: 44px;\n  padding: 0 10px;\n  font-size: 16px;\n}\n.reader-frame {\n  background: var(--surface);\n}\n.panel-actions button {\n  min-height: 52px;\n}\n@media (max-width: 480px) {\n  .panel-actions {\n    grid-template-columns: 1fr 1fr;\n    gap: 10px;\n  }\n  .panel-actions .view-archive {\n    grid-column: 1/-1;\n  }\n  .panel-emblem {\n    width: 88px;\n    height: 88px;\n    margin-bottom: 24px;\n  }\n  .panel-emblem svg {\n    width: 76px;\n    height: 76px;\n  }\n  .panel-main {\n    padding: 24px 0;\n  }\n  .panel .row input,\n  .panel .go {\n    height: 56px;\n  }\n}\n@media (max-height: 450px) {\n  .panel-emblem {\n    display: none;\n  }\n  .panel-main {\n    margin: 12px auto 0;\n    padding: 0;\n  }\n}\n.history-browser {\n  display: flex;\n  flex-direction: column;\n  flex: 1;\n  min-height: 0;\n  padding: 10px 16px;\n  gap: 10px;\n}\n.history-search {\n  width: 100%;\n  min-height: 44px;\n  flex: none;\n}\n.history-list {\n  overflow: auto;\n  min-height: 0;\n  flex: 1;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n.history-card {\n  display: block;\n  width: 100%;\n  flex: none;\n  text-align: left;\n  padding: 14px;\n  border: 1px solid var(--line);\n  border-radius: 14px;\n  background: var(--control);\n  color: var(--ink);\n}\n.history-card:hover {\n  background: var(--accent);\n}\n.history-card strong {\n  font-size: 14px;\n}\n.history-card span {\n  display: block;\n  margin-top: 5px;\n  font-size: 12px;\n  color: var(--muted);\n}\n.history-card p {\n  margin: 8px 0 0;\n  font-size: 13px;\n  line-height: 1.6;\n  max-height: 4.8em;\n  overflow: hidden;\n  overflow-wrap: anywhere;\n}\n.history-pagination {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 12px;\n  font-size: 13px;\n}\n.history-pagination button {\n  min-height: 44px;\n  padding: 0 12px;\n  background: var(--control);\n  color: var(--ink);\n  border: 1px solid var(--line);\n  border-radius: 10px;\n}\n.history-empty {\n  padding: 24px 8px;\n  font-size: 14px;\n  color: var(--muted);\n  text-align: center;\n}\n.wrap.mobile .rail {\n  width: 48px;\n  padding: 2px;\n  border-radius: 24px 0 0 24px;\n  gap: 2px;\n  transition: transform 180ms ease;\n}\n.wrap.mobile:not(.rail-expanded) .rail {\n  transform: translateX(100%);\n  visibility: hidden;\n  pointer-events: none;\n}\n.wrap.mobile.rail-expanded .rail {\n  transform: translateX(0);\n}\n.wrap.mobile .dock-handle {\n  display: block;\n}\n.wrap.mobile.rail-expanded .dock-handle {\n  right: 100%;\n}\n.wrap.mobile .dock-handle:focus-visible {\n  outline: none;\n}\n.wrap.mobile .dock-handle:focus-visible::before {\n  width: 7px;\n  opacity: 1;\n}\n.wrap.mobile.left .rail {\n  border-radius: 0 24px 24px 0;\n}\n.wrap.mobile .rail button {\n  width: 44px;\n  height: 44px;\n}\n.wrap.mobile .rail .bird {\n  height: 48px;\n}\n.wrap.mobile .bird svg {\n  width: 40px;\n  height: 40px;\n}\n.wrap.mobile.shelved .rail {\n  flex-direction: column;\n  width: 48px;\n  padding: 3px;\n  border-radius: 24px 0 0 24px;\n  gap: 2px;\n}\n.wrap.mobile.shelved .rail > .floor,\n.wrap.mobile.shelved .rail > .back {\n  display: none;\n}\n.wrap.mobile.shelved .rail > .up,\n.wrap.mobile.shelved .rail > .down {\n  display: grid;\n}\n.wrap.mobile.shelved .rail {\n  opacity: 0.8;\n}\n.wrap.mobile.shelved .rail:hover,\n.wrap.mobile.shelved .rail:focus-within {\n  opacity: 1;\n}\n.wrap.compact.short .reader-head {\n  grid-template-columns: minmax(0, 1fr) auto;\n}\n.wrap.compact.short .reader-heading {\n  grid-column: auto;\n}\n.wrap.compact.short .reader-prev,\n.wrap.compact.short .reader-next,\n.wrap.compact.short .reader-latest,\n.wrap.compact.short .reader-swipes,\n.wrap.compact.short .reader-raw,\n.wrap.compact.short .reader-archive {\n  display: none;\n}\n@media (max-width: 600px) {\n  .reader-head {\n    display: grid;\n    grid-template-columns: 44px 44px minmax(0, 1fr) auto;\n    gap: 6px;\n    padding: 10px;\n  }\n  .reader-heading {\n    grid-column: 1/-1;\n    padding: 2px 0 4px;\n  }\n  .reader-head button {\n    padding: 0 9px;\n  }\n  .reader-swipes {\n    padding: 6px 10px;\n    gap: 6px;\n  }\n  .reader-actions {\n    padding: 0 10px 6px;\n    gap: 6px;\n  }\n  .reader-options {\n    gap: 6px 8px;\n  }\n}\ninput[type='checkbox'] {\n  accent-color: var(--primary);\n}\n@media (max-width: 600px) {\n  .reader-head {\n    padding-top: max(10px, env(safe-area-inset-top));\n  }\n}\n@media (prefers-reduced-motion: reduce) {\n  *,\n  *::before,\n  *::after {\n    transition: none !important;\n  }\n}\n";

  // version.ts
  var SCRIPT_VERSION = "2.6.0";

  // ui.ts
  function createAssistantUi(doc) {
    const icon = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    const cat = CAT_ICON;
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
          <div class="heading"><div><h2 id="bird-title">喵喵消息助手</h2><p class="location"></p></div><button class="close" type="button" aria-label="收起面板">${icon('<path d="m6 6 12 12M6 18 18 6"/>')}</button></div>
          <div class="panel-main"><div class="panel-emblem">${cat}</div>
          <form novalidate><label for="bird-floor-input">楼层</label><div class="row"><input id="bird-floor-input" inputmode="numeric" autocomplete="off" aria-describedby="bird-status"><button class="go" type="submit">跳转</button></div></form>
          <div class="panel-edges"><button class="panel-up" type="button">${icon('<path d="m6 14 6-6 6 6"/><path d="M6 4h12"/>')}本层顶部</button><button class="panel-down" type="button">${icon('<path d="m6 10 6 6 6-6"/><path d="M6 20h12"/>')}本层底部</button></div>
          <div class="panel-actions"><button class="view-message" type="button">查看消息</button><button class="view-swipes" type="button">历史回复</button><button class="view-archive" type="button">回复目录</button></div>
          <button class="return" type="button" disabled>${icon('<path d="m9 5-5 5 5 5"/><path d="M4 10h10a6 6 0 0 1 0 12"/>')}<span>还没有需要返回的位置</span></button>
          <div class="bottom"><button class="side" type="button">移到左侧</button></div>
          <p class="status" id="bird-status" role="status" aria-live="polite" aria-atomic="true"></p></div>
        </section>
        <div class="toast" role="status" aria-live="polite" hidden></div>
        <div class="reader-mask" hidden></div>
        <section class="reader" role="dialog" aria-labelledby="bird-reader-title" tabindex="-1" hidden>
          <div class="reader-head"><div class="reader-heading"><h2 id="bird-reader-title">消息</h2></div>
            <button class="reader-prev" type="button" title="上一楼" aria-label="阅读上一楼">${icon('<path d="m14 6-6 6 6 6"/>')}</button>
            <button class="reader-next" type="button" title="下一楼" aria-label="阅读下一楼">${icon('<path d="m10 6 6 6-6 6"/>')}</button>
            <button class="reader-latest" type="button">最新</button>
            <button class="reader-exit" type="button">返回聊天</button>
          </div>
          <div class="reader-swipes"><button class="swipe-prev" type="button" aria-label="查看上一版本回复">${icon('<path d="m14 6-6 6 6 6"/>')}</button><span class="swipe-count"></span><button class="swipe-next" type="button" aria-label="查看下一版本回复">${icon('<path d="m10 6 6 6-6 6"/>')}</button><button class="swipe-current" type="button">当前</button></div>
          <div class="reader-actions"><button class="reader-raw" type="button" aria-pressed="false">原文</button><button class="reader-refresh" type="button">刷新</button><button class="reader-archive" type="button">目录</button><details class="reader-settings"><summary>显示设置</summary><div class="reader-options"><label><input class="reader-ignore-depth" type="checkbox" checked>忽略深度限制</label><label><input class="reader-body-only" type="checkbox">仅正文</label><label class="tag-field"><span>起始标签</span><input class="reader-start-tag" value="&lt;content&gt;" autocomplete="off"></label><label class="tag-field"><span>结束标签</span><input class="reader-end-tag" value="&lt;/content&gt;" autocomplete="off"></label></div></details></div>
          <section class="history-browser" aria-label="回复目录" hidden><input class="history-search" type="search" aria-label="搜索楼层、角色或内容" placeholder="搜索楼层、角色或内容"><div class="history-list"></div><div class="history-pagination"><button class="history-previous" type="button">上一页</button><span class="history-page"></span><button class="history-next" type="button">下一页</button></div></section>
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
      swipes: $2(".view-swipes")
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
      list: $2(".history-list"),
      previous: $2(".history-previous"),
      next: $2(".history-next"),
      page: $2(".history-page")
    };
    return { host, shadow, $: $2, ui, reader, archive };
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
    let archivePage = 0;
    let archiveRows = [];
    let searchTimer = 0;
    const renderCache = /* @__PURE__ */ new Map();
    let renderPipeline = [];
    let layoutFrame = 0;
    let chat = null;
    let messages = [];
    let identity = "";
    let highlighted = null;
    let highlightTimer = 0;
    let dragging = null;
    let suppressClick = false;
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
    const floorId = (el) => Number(el.getAttribute("mesid"));
    const floorElement = (id) => chat?.querySelector(`.mes[mesid="${id}"]`);
    const readerDocument = () => {
      try {
        return reader.frame.contentDocument;
      } catch (_) {
        return null;
      }
    };
    const hideReader = () => {
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
    const update = () => {
      if (disposed) return;
      const ctx = context(), nextKey = chatKey(ctx);
      if (nextKey !== identity) {
        identity = nextKey;
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
      ui.back.disabled = ui.return.disabled = busy || !history.length;
      setText(ui.return.querySelector("span"), history.length ? `返回 ${history.at(-1).id} 楼` : "返回");
      if (ui.panel.getAttribute("aria-busy") !== String(busy)) ui.panel.setAttribute("aria-busy", String(busy));
      reader.previous.disabled = busy || archiveMode || !readerState || readerState.id <= 0;
      reader.next.disabled = busy || archiveMode || !readerState || readerState.id >= last;
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
      ui.panel.style.left = `${bounds.x}px`;
      ui.panel.style.top = `${bounds.y}px`;
      ui.panel.style.width = `${width}px`;
      ui.panel.style.height = `${winHeight}px`;
      const toastWidth = ui.toast.offsetWidth || 220;
      ui.toast.style.left = `${Math.max(8, Math.min(width - toastWidth - 8, onLeft ? left + 70 : left - toastWidth - 12)) - left}px`;
      ui.toast.style.right = "auto";
      ui.side.textContent = onLeft ? "移到右侧" : "移到左侧";
      if (readerState || archiveMode) {
        reader.panel.style.left = `${bounds.x}px`;
        reader.panel.style.top = `${bounds.y}px`;
        reader.panel.style.width = `${width}px`;
        reader.panel.style.height = `${winHeight}px`;
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
      position = { x: r.left / page.innerWidth, y: r.top / page.innerHeight };
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
          },
          onEscape: () => {
            if (reader.settings.open) closeSettings();
            else exitReader();
          }
        });
        inside.scrollingElement.scrollTop = offset;
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
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      togglePanel();
    });
    listen(ui.dockHandle, "pointerdown", (event) => {
      if (event.isPrimary && event.button === 0) ui.dockHandle.setPointerCapture(event.pointerId);
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
      const before = snapshot(), id = readerState.id + delta;
      if (id < 0 || id > lastId()) return;
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
    for (const field of [reader.ignoreDepth, reader.bodyOnly, reader.start, reader.end])
      listen(field, "change", changeReaderSettings);
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
      const result = renderArchivePage(doc, archive, archiveRows, archivePage, archive.search.value);
      archivePage = result.page;
    };
    const openArchive = () => {
      if (busy) return;
      update();
      archiveRows = collectArchiveRows(context()?.chat, page, lastId());
      if (!readerState && !archiveMode) saveHistory(snapshot());
      archiveMode = true;
      archivePage = 0;
      archive.search.value = "";
      reader.panel.hidden = reader.mask.hidden = false;
      archive.panel.hidden = false;
      reader.frame.hidden = true;
      $2(".reader-swipes").hidden = $2(".reader-actions").hidden = true;
      reader.title.textContent = "回复目录";
      closePanel();
      renderArchive();
      update();
      place();
      archive.search.focus({ preventScroll: true });
    };
    listen($2(".view-archive"), "click", openArchive);
    listen($2(".reader-archive"), "click", openArchive);
    listen(archive.search, "input", () => {
      page.clearTimeout(searchTimer);
      searchTimer = page.setTimeout(() => {
        archivePage = 0;
        renderArchive();
      }, 150);
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
      if (!ui.panel.hidden && !path.includes(host)) closePanel();
    });
    listen(doc, "keydown", (event) => {
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
    listen(ui.bird, "pointerdown", (event) => {
      if (event.button !== 0 || busy || ui.wrap.classList.contains("compact")) return;
      suppressClick = false;
      const r = host.getBoundingClientRect();
      dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, left: r.left, top: r.top, moved: false };
      ui.bird.setPointerCapture(event.pointerId);
    });
    listen(ui.bird, "pointermove", (event) => {
      if (!dragging || event.pointerId !== dragging.id) return;
      const dx = event.clientX - dragging.x, dy = event.clientY - dragging.y;
      if (!dragging.moved && Math.hypot(dx, dy) < 7) return;
      dragging.moved = true;
      closePanel();
      position = { x: (dragging.left + dx) / page.innerWidth, y: (dragging.top + dy) / page.innerHeight };
      requestPlace();
    });
    const endDrag = (event) => {
      if (!dragging || event.pointerId !== dragging.id) return;
      suppressClick = dragging.moved;
      if (dragging.moved) {
        place();
        persistPosition();
      }
      dragging = null;
    };
    listen(ui.bird, "pointerup", endDrag);
    listen(ui.bird, "pointercancel", endDrag);
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
        chatObserver = new page.MutationObserver(scan);
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

  // index.ts
  $(() => errorCatched(startAssistant)());
})();
