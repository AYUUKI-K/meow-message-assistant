import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const sourceDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.MEOW_BUILD_TOOLS
  ? join(resolve(process.env.MEOW_BUILD_TOOLS), 'package.json')
  : import.meta.url);
const { build } = require('esbuild');
const versionSource = await readFile(join(sourceDir, 'version.ts'), 'utf8');
const version = versionSource.match(/SCRIPT_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1];
if (!version) throw new Error('version.ts 缺少 SCRIPT_VERSION');

const result = await build({
  absWorkingDir: sourceDir,
  entryPoints: ['index.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  write: false,
  minify: false,
  legalComments: 'none',
  charset: 'utf8',
  plugins: [{
    name: 'inline-css',
    setup(builder) {
      builder.onResolve({ filter: /\.css\?raw$/ }, args => ({
        path: resolve(args.resolveDir, args.path.slice(0, -4)),
        namespace: 'inline-css',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'inline-css' }, async args => ({
        contents: await readFile(args.path, 'utf8'),
        loader: 'text',
      }));
    },
  }],
});
const content = result.outputFiles[0].text;
new Script(content, { filename: '喵喵消息助手.js' });
const loaderResult = await build({
  absWorkingDir: sourceDir,
  entryPoints: ['online-loader.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  write: false,
  legalComments: 'none',
  charset: 'utf8',
});
const loader = loaderResult.outputFiles[0].text;
new Script(loader, { filename: '喵喵消息助手在线加载器.js' });
const script = {
  type: 'script',
  enabled: false,
  name: `喵喵消息助手 v${version}`,
  id: '2f3d0b1f-4091-4c06-8db4-729368afac0b',
  content: loader,
  info: '在线更新版 · 来信喵 SVG。刷新酒馆或重新启用脚本时读取 GitHub 最新发布。手机侧边收纳、上下速回、历史消息、Swipe 与回复目录。启用前请停用旧版助手及独立 Swipe 脚本。',
  button: { enabled: false, buttons: [] },
  data: {},
  export_with: { data: false, button: false },
};
const output = join(sourceDir, '..', '喵喵消息助手-酒馆助手导入.json');
await writeFile(output, JSON.stringify(script, null, 2) + '\n', 'utf8');
if (process.env.MEOW_RELEASE_DIR) {
  const releaseDir = resolve(process.env.MEOW_RELEASE_DIR);
  await mkdir(releaseDir, { recursive: true });
  const digest = createHash('sha256').update(content).digest('hex');
  const file = `meow-${digest.slice(0, 16)}.js`;
  await writeFile(join(releaseDir, file), content, 'utf8');
  await writeFile(join(releaseDir, 'latest.json'), JSON.stringify({ version, file, sha256: digest }, null, 2) + '\n', 'utf8');
  await writeFile(join(releaseDir, 'meow-assistant.json'), JSON.stringify(script, null, 2) + '\n', 'utf8');
  await writeFile(join(releaseDir, 'meow-offline.json'), JSON.stringify({
    ...script, content, info: '离线完整版 · 不联网检查助手更新。启用前请停用旧版助手及独立 Swipe 脚本。',
  }, null, 2) + '\n', 'utf8');
}
console.log(`已打包 ${script.name}\n${output}`);
