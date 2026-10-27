import { messagePreview } from './archive';
export type SearchRow = { id: number; name: string; role: string; text: string };

export function collectSearchRows(chat: any, page: any, lastId: number): SearchRow[] {
  if (Array.isArray(chat)) return chat.map((m, id) => ({
    id, name: m.name || '', role: m.is_user ? '用户' : m.is_system || m.extra?.type === 'narrator' ? '系统' : '助手',
    text: String(m.mes ?? m.swipes?.[m.swipe_id || 0] ?? ''),
  }));
  const helper = page.TavernHelper;
  const get = typeof getChatMessages === 'function' ? getChatMessages : helper?.getChatMessages?.bind(helper);
  return lastId < 0 ? [] : (get?.(`0-${lastId}`) ?? []).map(m => ({
    id: m.message_id, name: m.name || '', role: m.role === 'user' ? '用户' : m.role === 'system' ? '系统' : '助手',
    text: String(m.message ?? m.mes ?? ''),
  }));
}

export async function searchFloors(rows: SearchRow[], keyword: string, include: (row: SearchRow) => boolean,
  cancelled: () => boolean, yieldWork: () => Promise<void>): Promise<SearchRow[] | null> {
  const query = keyword.trim().replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).toLocaleLowerCase();
  const floor = /^(?:#|第\s*)?(\d+)\s*(?:楼|层)?$/.exec(query);
  const result: SearchRow[] = [];
  let started = performance.now();
  for (let i = 0; i < rows.length; i++) {
    if (cancelled()) return null;
    const row = rows[i];
    if (include(row) && (!query || (floor ? row.id === Number(floor[1]) :
      `${row.name} ${row.role}`.toLocaleLowerCase().includes(query) || row.text.toLocaleLowerCase().includes(query)))) result.push(row);
    if (i % 32 === 31 && performance.now() - started >= 6) { await yieldWork(); started = performance.now(); }
  }
  return cancelled() ? null : result;
}

export function renderSearchPage(doc: Document, archive: Record<string, any>, rows: SearchRow[], requested: number, keyword: string) {
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  const page = Math.max(0, Math.min(pages - 1, requested));
  archive.page.textContent = `${page + 1} / ${pages} · ${rows.length} 层`;
  archive.previous.disabled = page === 0;
  archive.next.disabled = page === pages - 1;
  archive.list.replaceChildren();
  for (const row of rows.slice(page * 10, page * 10 + 10)) {
    const card = doc.createElement('button'); card.type = 'button'; card.className = 'history-card'; card.dataset.floor = String(row.id);
    const title = doc.createElement('strong'); title.textContent = `${row.id} 楼 · ${row.name || row.role}`;
    const meta = doc.createElement('span'); meta.textContent = row.role;
    const preview = doc.createElement('p');
    const index = keyword.trim() ? row.text.toLocaleLowerCase().indexOf(keyword.trim().toLocaleLowerCase()) : 0;
    const start = Math.max(0, index - 45);
    preview.textContent = (start ? '…' : '') + messagePreview(row.text.slice(start));
    card.append(title, meta, preview); archive.list.appendChild(card);
  }
  if (!rows.length) { const empty = doc.createElement('p'); empty.className = 'history-empty'; empty.textContent = '没有匹配的楼层'; archive.list.appendChild(empty); }
  archive.list.scrollTop = 0;
  return page;
}
