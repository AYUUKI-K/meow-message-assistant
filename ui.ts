import { CAT_ICON } from './cat-icons';
import styles from './assistant.css?raw';
import { SCRIPT_VERSION } from './version';

export interface AssistantUi {
  host: HTMLDivElement;
  shadow: ShadowRoot;
  $: (selector: string) => any;
  ui: Record<string, any>;
  reader: Record<string, any>;
  archive: Record<string, any>;
}

export function createAssistantUi(doc: Document): AssistantUi {
  const icon = (body: string) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const cat = CAT_ICON;
  const autoControls = () => `<div class="auto-controls"><button class="auto-toggle" type="button" aria-pressed="false">自动阅读</button><select class="auto-speed" aria-label="自动阅读速度"><option value="16">慢速</option><option value="24" selected>舒适</option><option value="40">较快</option><option value="64">快速</option></select><label class="auto-next"><input class="auto-continue" type="checkbox">读完续楼</label></div>`;
  const host = doc.createElement('div');
  host.id = 'bird-floor-navigator';
  host.dataset.version = SCRIPT_VERSION;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
      <style>${styles}</style>
      <div class="wrap">
        <button class="dock-handle" type="button" aria-label="展开侧边按钮" aria-description="轻点展开，长按后上下拖动调整位置" aria-expanded="false" title="轻点展开，长按上下拖动"></button>
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
          <div class="panel-actions"><button class="view-message" type="button">查看消息</button><button class="view-swipes" type="button">历史回复</button><button class="view-archive" type="button">回复目录</button><button class="view-bookmarks" type="button">收藏夹</button><button class="view-search" type="button">搜索楼层</button></div>
          <button class="return" type="button" disabled>${icon('<path d="m9 5-5 5 5 5"/><path d="M4 10h10a6 6 0 0 1 0 12"/>')}<span>还没有需要返回的位置</span></button>
          <div class="panel-preferences"><label><input class="pref-hide-user" type="checkbox">隐藏用户输入楼层</label><label><input class="pref-return-top" type="checkbox">输出完成后回到本楼顶部</label></div>
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
          <div class="reader-actions"><button class="reader-bookmark" type="button" aria-pressed="false">☆ 收藏</button><label class="bookmark-title-wrap"><span>备注</span><input class="bookmark-title" type="text" maxlength="80" placeholder="番外·xx小剧场" aria-label="当前楼层的收藏备注标题"></label><button class="reader-bookmarks" type="button">收藏夹</button><button class="reader-raw" type="button" aria-pressed="false">原文</button><button class="reader-refresh" type="button">刷新</button><button class="reader-archive" type="button">回复目录</button><button class="reader-search" type="button">搜索楼层</button><details class="reader-settings"><summary>显示设置</summary><div class="reader-options"><label><input class="reader-ignore-depth" type="checkbox" checked>忽略深度限制</label><label><input class="reader-body-only" type="checkbox">仅正文</label><label><input class="reader-skip-bookmarks" type="checkbox" checked>跳过收藏楼层</label><label><input class="pref-hide-user" type="checkbox">隐藏用户输入楼层</label><label><input class="pref-return-top" type="checkbox">输出完成后回到本楼顶部</label><label class="tag-field"><span>起始标签</span><input class="reader-start-tag" value="&lt;content&gt;" autocomplete="off"></label><label class="tag-field"><span>结束标签</span><input class="reader-end-tag" value="&lt;/content&gt;" autocomplete="off"></label></div></details></div>
          <div class="reader-auto">${autoControls()}</div>
          <section class="history-browser" aria-label="消息目录" hidden><div class="history-filters"><input class="history-search" type="search" aria-label="搜索楼层、标题、角色或内容" placeholder="搜索楼层、标题、角色或内容"><label><input class="history-hide-bookmarks" type="checkbox">隐藏收藏楼层</label><label><input class="pref-hide-user" type="checkbox">隐藏用户输入楼层</label></div><div class="history-list"></div><div class="history-pagination"><button class="history-previous" type="button">上一页</button><span class="history-page" aria-live="polite"></span><button class="history-next" type="button">下一页</button></div></section>
          <iframe class="reader-frame" title="历史楼层正文" sandbox="allow-same-origin allow-scripts" referrerpolicy="no-referrer"></iframe>
        </section>
      </div>`;
  doc.body.appendChild(host);
  const $ = (selector: string): any => shadow.querySelector(selector);
  const ui = {
    wrap: $('.wrap'),
    rail: $('.rail'),
    dockHandle: $('.dock-handle'),
    panel: $('.panel'),
    bird: $('.bird'),
    input: $('#bird-floor-input'),
    status: $('.status'),
    toast: $('.toast'),
    up: $('.up'),
    down: $('.down'),
    panelUp: $('.panel-up'),
    panelDown: $('.panel-down'),
    back: $('.back'),
    return: $('.return'),
    go: $('.go'),
    floor: $('.floor'),
    location: $('.location'),
    side: $('.side'),
    view: $('.view-message'),
    swipes: $('.view-swipes'),
    viewBookmarks: $('.view-bookmarks'),
  };
  const reader = {
    panel: $('.reader'),
    mask: $('.reader-mask'),
    frame: $('.reader-frame'),
    title: $('#bird-reader-title'),
    previous: $('.reader-prev'),
    next: $('.reader-next'),
    exit: $('.reader-exit'),
    latest: $('.reader-latest'),
    ignoreDepth: $('.reader-ignore-depth'),
    bodyOnly: $('.reader-body-only'),
    start: $('.reader-start-tag'),
    end: $('.reader-end-tag'),
    raw: $('.reader-raw'),
    bookmark: $('.reader-bookmark'),
    bookmarkTitle: $('.bookmark-title'),
    bookmarks: $('.reader-bookmarks'),
    skipBookmarks: $('.reader-skip-bookmarks'),
    refresh: $('.reader-refresh'),
    settings: $('.reader-settings'),
    swipePrevious: $('.swipe-prev'),
    swipeNext: $('.swipe-next'),
    swipeCurrent: $('.swipe-current'),
    swipeCount: $('.swipe-count'),
  };
  const archive = {
    panel: $('.history-browser'),
    search: $('.history-search'),
    hideBookmarks: $('.history-hide-bookmarks'),
    list: $('.history-list'),
    previous: $('.history-previous'),
    next: $('.history-next'),
    page: $('.history-page'),
  };
  return { host, shadow, $, ui, reader, archive };
}
