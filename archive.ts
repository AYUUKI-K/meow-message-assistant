export type ArchiveRow = {
  id: number;
  name: string;
  role: string;
  swipes: string[];
  current: number;
};

export function messagePreview(text: unknown): string {
  return String(text || '')
    .slice(0, 4000)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export function collectArchiveRows(chat: any, page: Window & typeof globalThis, lastId: number): ArchiveRow[] {
  const rows: ArchiveRow[] = [];
  if (Array.isArray(chat)) {
    chat.forEach((message, id) => {
      if (Array.isArray(message.swipes) && message.swipes.length > 1) {
        rows.push({
          id,
          name: message.name || '',
          role: message.extra?.type === 'narrator' ? '系统' : message.is_user ? '用户' : '助手',
          swipes: message.swipes.map((text: unknown) => (typeof text === 'string' ? text : '')),
          current: message.swipe_id || 0,
        });
      }
    });
    return rows;
  }

  const helper = (page as any).TavernHelper;
  const get = typeof getChatMessages === 'function' ? getChatMessages : helper?.getChatMessages?.bind(helper);
  if (lastId >= 0) {
    for (const message of get?.(`0-${lastId}`, { include_swipes: true }) ?? []) {
      if (message.swipes?.length > 1) {
        rows.push({
          id: message.message_id,
          name: message.name || '',
          role: message.role === 'user' ? '用户' : message.role === 'system' ? '系统' : '助手',
          swipes: message.swipes,
          current: message.swipe_id || 0,
        });
      }
    }
  }
  return rows;
}

export function renderArchivePage(
  doc: Document,
  archive: Record<string, any>,
  rows: ArchiveRow[],
  requestedPage: number,
  keyword: string,
  hideBookmarked = false,
  isBookmarked: (id: number) => boolean = () => false,
): { page: number; pages: number } {
  const normalized = keyword.trim().toLocaleLowerCase();
  const filtered = rows.filter(
    row =>
      (!hideBookmarked || !isBookmarked(row.id)) &&
      (!normalized ||
        `${row.id} ${row.name} ${row.role}`.toLocaleLowerCase().includes(normalized) ||
        row.swipes.some(text => text.toLocaleLowerCase().includes(normalized))),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const page = Math.max(0, Math.min(pages - 1, requestedPage));
  archive.page.textContent = `${page + 1} / ${pages} · ${filtered.length} 层`;
  archive.previous.disabled = page === 0;
  archive.next.disabled = page >= pages - 1;
  archive.list.replaceChildren();

  for (const row of filtered.slice(page * 10, page * 10 + 10)) {
    const card = doc.createElement('button');
    card.type = 'button';
    card.className = 'history-card';
    card.dataset.floor = String(row.id);
    const title = doc.createElement('strong');
    title.textContent = `${isBookmarked(row.id) ? '★ ' : ''}${row.id} 楼 · ${row.name || row.role}`;
    const meta = doc.createElement('span');
    meta.textContent = `${row.role} · ${row.swipes.length} 个版本`;
    const preview = doc.createElement('p');
    preview.textContent = messagePreview(row.swipes[row.current] || row.swipes[0]);
    card.append(title, meta, preview);
    archive.list.appendChild(card);
  }

  if (!filtered.length) {
    const empty = doc.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = rows.length ? '没有匹配的楼层' : '没有多版本回复';
    archive.list.appendChild(empty);
  }
  archive.list.scrollTop = 0;
  return { page, pages };
}

export type BookmarkRow = {
  id: number;
  title: string;
  role: string;
  preview: string;
};

export function renderBookmarkPage(
  doc: Document,
  archive: Record<string, any>,
  rows: BookmarkRow[],
  requestedPage: number,
  keyword: string,
): { page: number; pages: number } {
  const normalized = keyword.trim().toLocaleLowerCase();
  const filtered = rows.filter(row =>
    !normalized || `${row.id} ${row.title} ${row.role} ${row.preview}`.toLocaleLowerCase().includes(normalized),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const page = Math.max(0, Math.min(pages - 1, requestedPage));
  archive.page.textContent = `${page + 1} / ${pages} · ${filtered.length} 条收藏`;
  archive.previous.disabled = page === 0;
  archive.next.disabled = page >= pages - 1;
  archive.list.replaceChildren();

  for (const row of filtered.slice(page * 10, page * 10 + 10)) {
    const card = doc.createElement('button');
    card.type = 'button';
    card.className = 'history-card';
    card.dataset.floor = String(row.id);
    const title = doc.createElement('strong');
    title.textContent = row.title || `${row.id} 楼`;
    const meta = doc.createElement('span');
    meta.textContent = `第 ${row.id} 楼 · ${row.role}`;
    const preview = doc.createElement('p');
    preview.textContent = row.preview;
    card.append(title, meta, preview);
    archive.list.appendChild(card);
  }

  if (!filtered.length) {
    const empty = doc.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = rows.length ? '没有匹配的收藏' : '还没有收藏消息';
    archive.list.appendChild(empty);
  }
  archive.list.scrollTop = 0;
  return { page, pages };
}
