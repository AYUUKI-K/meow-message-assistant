type MessageAccessOptions = {
  page: Window & typeof globalThis;
  context: () => any;
  lastId: () => number;
};

/** Reads stored swipes without changing the selected swipe or loading more chat floors. */
export function createMessageAccess({ page, context, lastId }: MessageAccessOptions) {
  const cache = new Map<number, any>();

  const readMessage = (id: number) => {
    let message = context()?.chat?.[id];
    const cached = cache.get(id);
    if (!message) {
      const helper = (page as any).TavernHelper;
      const get = typeof getChatMessages === 'function' ? getChatMessages : helper?.getChatMessages?.bind(helper);
      let item: any;
      try {
        item = get?.(id, { include_swipes: true })?.[0];
      } catch (error) {
        if (cached) return { ...cached, cached: true };
        throw error;
      }
      if (item) {
        message = {
          name: item.name,
          mes: item.swipes?.[item.swipe_id] ?? item.message ?? '',
          swipes: item.swipes,
          swipe_id: item.swipe_id,
          is_user: item.role === 'user',
          is_system: item.is_hidden,
          extra: item.extra,
        };
      }
    }

    if (
      !message ||
      (!message.mes && !message.swipes?.some((text: unknown) => typeof text === 'string' && text.length))
    ) {
      if (cached) return { ...cached, cached: true };
      if (!message) throw new Error(`无法读取 ${id} 楼的数据。`);
    }

    const swipes =
      Array.isArray(message.swipes) && message.swipes.length
        ? message.swipes.map((text: unknown) => (typeof text === 'string' ? text : ''))
        : [message.mes ?? ''];
    const currentSwipeId = Math.max(0, Math.min(swipes.length - 1, Number(message.swipe_id) || 0));
    if (message.mes) swipes[currentSwipeId] = message.mes;
    const result = { ...message, swipes, swipe_id: currentSwipeId, mes: swipes[currentSwipeId], cached: false };
    cache.delete(id);
    cache.set(id, result);
    if (cache.size > 12) cache.delete(cache.keys().next().value!);
    return result;
  };

  const nearestAssistant = (limit = lastId()) => {
    const items = context()?.chat;
    if (Array.isArray(items)) {
      for (let id = Math.min(limit, items.length - 1); id >= 0; id--) {
        if (!items[id].is_user && items[id].extra?.type !== 'narrator') return id;
      }
    } else {
      const helper = (page as any).TavernHelper;
      const get = typeof getChatMessages === 'function' ? getChatMessages : helper?.getChatMessages?.bind(helper);
      const messages = get?.(`0-${Math.max(0, limit)}`, { role: 'assistant', include_swipes: true });
      if (messages?.length) return messages.at(-1).message_id;
    }
    return null;
  };

  return { readMessage, nearestAssistant, clear: () => cache.clear() };
}
