import { SCRIPT_VERSION } from './version';

/** 只更新当前脚本的显示名称；代码、开关、变量和其他脚本均原样保留。 */
export function syncScriptMetadata() {
  try {
    if (typeof getScriptId !== 'function') return;
    const helper = window.parent?.TavernHelper;
    const getTrees = typeof getScriptTrees === 'function' ? getScriptTrees : helper?.getScriptTrees;
    const updateTrees = typeof updateScriptTreesWith === 'function' ? updateScriptTreesWith : helper?.updateScriptTreesWith;
    if (!getTrees || !updateTrees) return;
    const id = getScriptId();
    const name = `喵喵消息助手 v${SCRIPT_VERSION}`;
    const find = (trees: any[]): any => {
      for (const item of trees) {
        if (item.type === 'script' && item.id === id) return item;
        if (item.type === 'folder') { const found = find(item.scripts ?? []); if (found) return found; }
      }
      return null;
    };
    for (const type of ['global', 'preset', 'character'] as const) {
      const own = find(getTrees({ type }));
      if (!own) continue;
      if (own.name !== name && /^喵喵消息助手(?:\s+v[\d.]+)?$/.test(own.name)) {
        updateTrees(trees => {
          const current = find(trees);
          if (current) current.name = name;
          return trees;
        }, { type });
      }
      return;
    }
  } catch (error) { console.warn('[喵喵消息助手] 列表版本名称同步失败', error); }
}
