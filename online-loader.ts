/** 每次启用时读取最新发布清单，加载带内容指纹的完整脚本。 */
const repository = 'AYUUKI-K/meow-message-assistant';
const releaseBase = `https://cdn.jsdelivr.net/gh/${repository}@release/`;
const mirrorBase = `https://testingcf.jsdelivr.net/gh/${repository}@release/`;

async function loadLatestAssistant() {
  const manifests = [
    `https://raw.githubusercontent.com/${repository}/release/latest.json`,
    `${releaseBase}latest.json`,
    `${mirrorBase}latest.json`,
  ];
  let manifest: { version: string; file: string } | undefined;
  let lastError: unknown;
  for (const endpoint of manifests) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${endpoint}?t=${Date.now()}`, {
        cache: 'no-store', credentials: 'omit', signal: controller.signal,
      });
      if (!response.ok) throw new Error(`更新清单 HTTP ${response.status}`);
      const data = await response.json();
      if (typeof data.version !== 'string' || !/^meow-[a-f0-9]{16}\.js$/.test(data.file)) {
        throw new Error('更新清单格式不正确');
      }
      manifest = data;
      break;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  if (!manifest) throw lastError ?? new Error('无法取得更新清单');
  for (const base of [releaseBase, mirrorBase]) {
    try {
      await import(/* webpackIgnore: true */ `${base}${manifest.file}`);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

void loadLatestAssistant().catch(error => {
  console.error('[喵喵消息助手] 在线加载失败', error);
  if (typeof toastr !== 'undefined') {
    toastr.error('喵喵消息助手加载失败，请检查网络后重新启用脚本。');
  }
});
