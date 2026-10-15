import { createHtmlDocumentRenderer } from './html-document';

type MessageRendererOptions = {
  page: Window & typeof globalThis;
  doc: Document;
  host: HTMLElement;
  reader: Record<string, any>;
  context: () => any;
  lastId: () => number;
};

/** Applies Tavern display formatting and mounts interactive HTML documents in isolated frames. */
export function createMessageRenderer({ page, doc, host, reader, context, lastId }: MessageRendererOptions) {
  const displayRegex = () =>
    typeof formatAsTavernRegexedString === 'function'
      ? formatAsTavernRegexedString
      : (page as any).TavernHelper?.formatAsTavernRegexedString?.bind((page as any).TavernHelper);
  const messageFormatter = () =>
    typeof formatAsDisplayedMessage === 'function'
      ? formatAsDisplayedMessage
      : (page as any).TavernHelper?.formatAsDisplayedMessage?.bind((page as any).TavernHelper);
  const markdownRenderer = () =>
    typeof builtin !== 'undefined' ? builtin.renderMarkdown : (page as any).TavernHelper?.builtin?.renderMarkdown;

  const preserveTextLineBreaks = (root: DocumentFragment | HTMLElement) => {
    const blocks = new Set([
      'DIV',
      'P',
      'SECTION',
      'ARTICLE',
      'ASIDE',
      'MAIN',
      'HEADER',
      'FOOTER',
      'NAV',
      'DETAILS',
      'SUMMARY',
      'TABLE',
      'THEAD',
      'TBODY',
      'TFOOT',
      'TR',
      'TD',
      'TH',
      'UL',
      'OL',
      'LI',
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'BLOCKQUOTE',
      'HR',
      'PRE',
      'FIGURE',
      'FIGCAPTION',
      'CONTENT',
      'MEOW_FM',
      'SNOW',
    ]);
    const inline = (node: Node | null) =>
      node &&
      (node.nodeType === 3
        ? !!node.nodeValue?.trim()
        : node.nodeType === 1 && (node as Element).tagName !== 'BR' && !blocks.has((node as Element).tagName));
    const neighbor = (node: Node, direction: 'previousSibling' | 'nextSibling') => {
      let next = node[direction];
      while (next?.nodeType === 8) next = next[direction];
      return next;
    };
    const walker = doc.createTreeWalker(root, page.NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      if (
        !/[\r\n]/.test(node.nodeValue ?? '') ||
        node.parentElement?.closest('style,script,pre,code,textarea,svg,math,template')
      )
        continue;
      // Existing preformatted regions already preserve whitespace; avoid doubling their line breaks.
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
      let value = (node.nodeValue ?? '').replace(/\r\n?/g, '\n');
      const previous = neighbor(node, 'previousSibling');
      const next = neighbor(node, 'nextSibling');
      if (!value.trim()) {
        // Indentation between HTML blocks is source formatting; a newline between inline text is content.
        if (!/^\n+$/.test(value) || !inline(previous) || !inline(next)) continue;
      } else {
        if (!inline(previous)) value = value.replace(/^[ \t]*\n[ \t\n]*/, '');
        if (!inline(next)) value = value.replace(/[ \t\n]*\n[ \t]*$/, '');
      }
      if (!value.includes('\n')) continue;
      const replacement = doc.createDocumentFragment();
      value.split('\n').forEach((line, index) => {
        if (index) replacement.appendChild(doc.createElement('br'));
        if (line) replacement.appendChild(doc.createTextNode(line));
      });
      node.replaceWith(replacement);
    }
  };

  const htmlDocuments = createHtmlDocumentRenderer({ page, doc, host, preserveLineBreaks: preserveTextLineBreaks });
  const htmlFragment = htmlDocuments.createFragment;

  const sanitizeContent = (root: DocumentFragment | ShadowRoot | HTMLElement) => {
    root
      .querySelectorAll('script,iframe,object,embed,meta,base,form,link:not([rel="stylesheet"])')
      .forEach(element => element.remove());
    for (const element of root.querySelectorAll('*')) {
      for (const attribute of Array.from(element.attributes)) {
        if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
        else if (
          /^(?:href|src|xlink:href|action|formaction|to|from|values)$/i.test(attribute.name) &&
          /(?:javascript|vbscript):|data:text\/html/i.test(attribute.value.replace(/\s/g, ''))
        )
          element.removeAttribute(attribute.name);
      }
      if (element.tagName === 'IMG') {
        (element as HTMLImageElement).loading = 'lazy';
        (element as HTMLImageElement).decoding = 'async';
      }
      if (element.tagName === 'TEMPLATE') sanitizeContent((element as HTMLTemplateElement).content);
    }
  };

  const renderContent = (id: number, message: any) => {
    const ctx = context();
    const regex = displayRegex();
    const render = markdownRenderer();
    const template = doc.createElement('template');
    reader.ignoreDepth.disabled = !regex;
    if (regex) {
      const source =
        message.extra?.type === 'narrator' && !message.is_user
          ? 'slash_command'
          : message.is_user
            ? 'user_input'
            : 'ai_output';
      const options: Record<string, unknown> = { character_name: message.name || undefined };
      if (!reader.ignoreDepth.checked) {
        // Tavern depth counts visible messages after the target floor.
        let depth = 0;
        if (Array.isArray(ctx?.chat)) {
          for (let next = id + 1; next < ctx.chat.length; next++) if (!ctx.chat[next].is_system) depth++;
        } else depth = Math.max(0, lastId() - id);
        options.depth = depth;
      }
      // Apply display regex once, and avoid APIs that would apply it a second time.
      let text = regex(message.mes, source, 'display', options);
      if (/^\s*(?:<!doctype\s+html\b|<html\b|<body\b)/i.test(text)) text = `\`\`\`html\n${text}\n\`\`\``;
      const fragments: string[] = [];
      let nonce: string;
      do {
        nonce = `BIRDFLOORHTML${Math.random().toString(36).slice(2).toUpperCase()}`;
      } while (text.includes(nonce));
      const markdown = text.replace(
        /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*(html?|xhtml)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\2[ \t]*(?=\r?\n|$)/gi,
        (_match, prefix, fence, _language, code) => {
          const token = `${nonce}${fragments.length}END`;
          fragments.push(htmlFragment(code));
          return `${prefix}\n\n${token}\n\n`;
        },
      );
      if (render) {
        let output = render(markdown);
        fragments.forEach((fragment, index) => {
          const token = `${nonce}${index}END`;
          output = output.replace(new RegExp(`<p>\\s*${token}\\s*</p>`, 'g'), () => fragment);
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
          const pre = doc.createElement('pre');
          pre.textContent = output;
          template.content.appendChild(pre);
        }
      }
    } else {
      const displayed = messageFormatter();
      if (displayed) template.innerHTML = displayed(message.mes, { message_id: id });
      else if (typeof ctx?.messageFormatting === 'function')
        template.innerHTML = ctx.messageFormatting(
          message.mes,
          message.name || '',
          !!message.is_system,
          !!message.is_user,
          id,
        );
      else if (render) template.innerHTML = render(message.mes);
      else {
        const pre = doc.createElement('pre');
        pre.textContent = message.mes;
        template.content.appendChild(pre);
      }
    }

    // Convert HTML code fences emitted by the host's Markdown formatter into rendered fragments.
    for (const code of template.content.querySelectorAll('pre > code')) {
      const markup = code.textContent ?? '';
      if (
        !/(?:language|lang)-(?:html|xhtml)\b|(?:^|\s)custom-html(?:\s|$)/i.test(code.className) &&
        !/^\s*(?:<!doctype\s+html|<html\b)/i.test(markup)
      )
        continue;
      const fragment = doc.createElement('template');
      fragment.innerHTML = htmlFragment(markup);
      code.parentElement!.replaceWith(fragment.content);
    }
    preserveTextLineBreaks(template.content);
    return template;
  };

  const extractBody = (text: string) => {
    if (!reader.bodyOnly.checked) return text;
    const start = reader.start.value.trim();
    const end = reader.end.value.trim();
    if (!start || !end) throw new Error('请填写正文的起始和结束标签。');
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = [...text.matchAll(new RegExp(`${escape(start)}([\\s\\S]*?)${escape(end)}`, 'g'))];
    return matches.length ? matches.map(match => match[1]).join('\n\n') : text;
  };

  const pipeline = () => [displayRegex() || messageFormatter() || context()?.messageFormatting, markdownRenderer()];
  return { renderContent, extractBody, sanitizeContent, ...htmlDocuments, pipeline };
}
