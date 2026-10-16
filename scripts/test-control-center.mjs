// 控制中心离线测试：SnowLuma 目录识别 / 数据迁移 / 更新检查 / HTTP 鉴权 / 子进程管理 / 合规不变量。
// 全部在临时目录里用假的 SnowLuma 目录和假的桥接脚本完成：不启动真实桥接、不启动真实 SnowLuma、不联网。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { inspectSnowLumaDir, compareVersions, migrateSnowLumaData, checkSnowLumaUpdate, snowlumaLaunchSpec } from '../src/launcher/snowluma-install.mjs';
import { createManagedProcess } from '../src/launcher/managed-process.mjs';
import { startControlCenter } from '../src/launcher/control-center.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qqb-cc-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeSnowLuma(dir, version, { full = true, files = {} } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@snowluma/runtime', version }));
  fs.writeFileSync(path.join(dir, 'index.mjs'), '');
  fs.writeFileSync(path.join(dir, 'launcher.bat'), '@echo off\r\necho fake snowluma\r\n');
  if (full) fs.writeFileSync(path.join(dir, 'node.exe'), '');
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

test('识别 SnowLuma 目录：版本、完整版/Lite、WebUI 端口、已配置账号；非 SnowLuma 目录拒绝', () => {
  const d = tmp();
  const full = fakeSnowLuma(path.join(d, 'full'), '1.14.22', { files: { 'config/runtime.json': JSON.stringify({ webuiPort: 6001 }), 'config/onebot_10001.json': '{}' } });
  const i = inspectSnowLumaDir(full);
  assert.equal(i.ok, true);
  assert.equal(i.version, '1.14.22');
  assert.equal(i.edition, 'full');
  assert.equal(i.webui.port, 6001);
  assert.deepEqual(i.accounts, ['10001']);
  const lite = inspectSnowLumaDir(fakeSnowLuma(path.join(d, 'lite'), '1.14.22', { full: false }));
  assert.equal(lite.edition, 'lite');
  assert.equal(lite.webui.port, 5099);
  fs.mkdirSync(path.join(d, 'other'));
  fs.writeFileSync(path.join(d, 'other', 'package.json'), JSON.stringify({ name: 'something-else' }));
  assert.equal(inspectSnowLumaDir(path.join(d, 'other')).ok, false);
  assert.equal(inspectSnowLumaDir(path.join(d, 'missing')).ok, false);
  assert.equal(inspectSnowLumaDir('').ok, false);
});

test('版本比较', () => {
  assert.equal(compareVersions('1.14.22', '1.14.3'), 1);
  assert.equal(compareVersions('v1.15.0', '1.14.99'), 1);
  assert.equal(compareVersions('1.14.22', '1.14.22'), 0);
  assert.equal(compareVersions('1.14.2', '1.14.22'), -1);
});

test('启动方式：按发行包自带的 launcher.bat 原样运行，不改任何文件', () => {
  const d = fakeSnowLuma(path.join(tmp(), 's'), '1.14.22');
  const spec = snowlumaLaunchSpec(inspectSnowLumaDir(d));
  assert.equal(spec.cwd, d);
  if (process.platform === 'win32') assert.deepEqual(spec.args.slice(-1), ['launcher.bat']);
  assert.ok(snowlumaLaunchSpec({ ok: false, error: 'x' }).error);
});

test('更新数据迁移：先备份，只复制 config/ 与 data/，不碰程序文件；新目录已有的数据改名保留', () => {
  const d = tmp();
  const from = fakeSnowLuma(path.join(d, 'old'), '1.14.22', { files: {
    'config/onebot_10001.json': '{"token":"fake"}', 'config/webui.json': '{}', 'data/10001/db.bin': 'x', 'logs/a.log': 'l', 'native/snowluma-win32-x64.node': 'OLD-NATIVE',
  } });
  const to = fakeSnowLuma(path.join(d, 'new'), '1.14.23', { files: { 'native/snowluma-win32-x64.node': 'NEW-NATIVE', 'config/runtime.json': '{"webuiPort":5099}' } });
  const r = migrateSnowLumaData({ fromDir: from, toDir: to, backupRoot: path.join(d, 'backups') });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.dirs, ['config', 'data']);
  assert.equal(fs.readFileSync(path.join(to, 'config', 'onebot_10001.json'), 'utf8'), '{"token":"fake"}');
  assert.equal(fs.readFileSync(path.join(to, 'data', '10001', 'db.bin'), 'utf8'), 'x');
  assert.equal(fs.readFileSync(path.join(to, 'native', 'snowluma-win32-x64.node'), 'utf8'), 'NEW-NATIVE', '新版本的程序文件不被覆盖');
  assert.ok(!fs.existsSync(path.join(to, 'logs')), '默认不迁移 logs');
  assert.ok(fs.existsSync(path.join(r.backupDir, 'config', 'onebot_10001.json')), '已备份');
  assert.ok(r.keptInNewDir.some((n) => n.startsWith('config.before-migrate-')), '新目录原有 config 改名保留');
  assert.ok(fs.existsSync(path.join(from, 'config', 'onebot_10001.json')), '旧目录原样保留');
});

test('更新数据迁移：拒绝降级、拒绝同一目录、拒绝无效目录', () => {
  const d = tmp();
  const a = fakeSnowLuma(path.join(d, 'a'), '1.14.22', { files: { 'config/x.json': '{}' } });
  const b = fakeSnowLuma(path.join(d, 'b'), '1.14.10');
  assert.match(migrateSnowLumaData({ fromDir: a, toDir: b, backupRoot: d }).error, /低于/);
  assert.match(migrateSnowLumaData({ fromDir: a, toDir: a, backupRoot: d }).error, /同一个/);
  assert.match(migrateSnowLumaData({ fromDir: a, toDir: path.join(d, 'nope'), backupRoot: d }).error, /新目录无效/);
});

test('检查更新：只读 GitHub 的 latest release，给出该下载的完整版文件名', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ tag_name: 'v1.15.0', html_url: 'https://github.com/SnowLuma/SnowLuma/releases/tag/v1.15.0', published_at: '2026-11-01T00:00:00Z', body: 'notes', assets: [{ name: 'SnowLuma-v1.15.0-win-x64-lite.zip' }, { name: 'SnowLuma-v1.15.0-win-x64.zip' }] }) });
  const r = await checkSnowLumaUpdate('1.14.22', { fetchImpl: fakeFetch });
  assert.equal(r.updateAvailable, true);
  assert.equal(r.latest, '1.15.0');
  assert.equal(r.suggestedAsset, 'SnowLuma-v1.15.0-win-x64.zip', '推荐完整版而不是 Lite');
});

test('子进程管理：捕获输出、脱敏、按需自动重启、停止', async () => {
  const d = tmp();
  const script = path.join(d, 'child.mjs');
  fs.writeFileSync(script, "console.log('hello password=hunter2'); console.error('oops'); setTimeout(() => process.exit(Number(process.env.CODE ?? 0)), 150);");
  let code = '3';
  const p = createManagedProcess({
    name: 't', logDir: path.join(d, 'logs'),
    redact: (s) => s.replace(/password=\S+/, 'password=***'),
    resolveLaunch: () => ({ command: process.execPath, args: [script], cwd: d, env: { CODE: code } }),
    shouldRestart: ({ code: c }) => c !== 0,
  });
  assert.equal(p.start().ok, true);
  assert.equal(p.start().ok, false, '不重复启动');
  await sleep(700);
  const lines = p.linesSince(0).map((l) => `${l.stream}:${l.text}`);
  assert.ok(lines.includes('stdout:hello password=***'), lines.join('|'));
  assert.ok(lines.includes('stderr:oops'));
  assert.ok(p.snapshot().restartPending, '非零退出后排队自动重启');
  code = '0';
  await p.stop();
  assert.equal(p.snapshot().restartPending, false, 'stop 取消待重启');
  assert.ok(fs.readdirSync(path.join(d, 'logs')).length >= 1, '日志落盘');
  // 长时间运行的进程可以被停止
  fs.writeFileSync(script, 'setInterval(() => {}, 1000);');
  p.start();
  await sleep(300);
  assert.equal(p.running, true);
  const s = await p.stop();
  assert.equal(s.ok, true);
  assert.equal(p.running, false);
});

// ── 控制中心 HTTP（临时项目根目录 + 假桥接）──────────────────────────────────

function req(port, method, route, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const r = http.request({ host: '127.0.0.1', port, path: route, method, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: j, text: b }); });
    });
    r.on('error', reject);
    r.end(data);
  });
}

async function withCenter(fn, { config = null } = {}) {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ version: '9.9.9-test' }));
  fs.mkdirSync(path.join(d, 'node_modules'));
  if (config) fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify(config));
  const fake = path.join(d, 'fake-bridge.mjs');
  fs.writeFileSync(fake, "console.log('fake bridge up'); if (process.env.QQ_BRIDGE_SUPERVISED !== '1') process.exit(9); setInterval(() => {}, 1000);");
  const cc = await startControlCenter({ open: false, port: 0, root: d, bridgeEntry: fake, installSignalHandlers: false, exitOnShutdown: false, log: () => {} });
  const T = { 'x-control-token': cc.token };
  try { await fn({ cc, d, T, port: cc.port }); } finally { await cc.shutdown('test'); }
}

test('控制中心：启动时不会启动桥接或 SnowLuma；页面无需令牌、接口需要令牌', async () => {
  await withCenter(async ({ cc, port, T }) => {
    assert.equal(cc.bridge.running, false);
    assert.equal(cc.snowluma.running, false);
    const page = await req(port, 'GET', '/');
    assert.equal(page.status, 200);
    assert.ok(page.text.includes('qq-bridge 控制中心'));
    assert.equal((await req(port, 'GET', '/api/state')).status, 401);
    assert.equal((await req(port, 'GET', '/api/state', { headers: { 'x-control-token': 'wrong' } })).status, 401);
    const st = await req(port, 'GET', '/api/state', { headers: T });
    assert.equal(st.status, 200);
    assert.equal(st.body.health.config.exists, false, '未部署也能打开');
  });
});

test('控制中心：拒绝外部 Host、跨站 Origin、非 JSON 请求', async () => {
  await withCenter(async ({ port, T }) => {
    assert.equal((await req(port, 'GET', '/api/state', { headers: { ...T, host: 'evil.example:80' } })).status, 403);
    assert.equal((await req(port, 'POST', '/api/bridge/start', { body: {}, headers: { ...T, origin: 'http://evil.example' } })).status, 403);
    const nonJson = await new Promise((resolve) => {
      const r = http.request({ host: '127.0.0.1', port, path: '/api/bridge/start', method: 'POST', headers: { ...T, 'content-type': 'text/plain' } }, (res) => { res.resume(); resolve(res.statusCode); });
      r.end('x');
    });
    assert.equal(nonJson, 415);
  });
});

test('控制中心：没有 config.json 时点「启动桥接」给出原因，不会启动', async () => {
  await withCenter(async ({ cc, port, T }) => {
    const r = await req(port, 'POST', '/api/bridge/start', { body: {}, headers: T });
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, /config\.json/);
    assert.equal(cc.bridge.running, false);
  });
});

test('控制中心：有配置时启动/停止桥接，日志可读', async () => {
  await withCenter(async ({ cc, port, T }) => {
    const s = await req(port, 'POST', '/api/bridge/start', { body: {}, headers: T });
    assert.equal(s.body.ok, true, JSON.stringify(s.body));
    await sleep(500);
    const logs = await req(port, 'GET', '/api/logs?source=bridge&after=0', { headers: T });
    assert.ok(logs.body.lines.some((l) => l.text === 'fake bridge up'), JSON.stringify(logs.body.lines.map((l) => l.text)));
    const stop = await req(port, 'POST', '/api/bridge/stop', { body: {}, headers: T });
    assert.equal(stop.body.ok, true);
    assert.equal(cc.bridge.running, false);
  }, { config: { consolePort: 1 } });
});

test('控制中心：命令行是固定命令集，不能执行任意程序', async () => {
  await withCenter(async ({ cc, d, port, T }) => {
    const marker = path.join(d, 'pwned.txt');
    for (const text of [`pwsh -c "New-Item ${marker}"`, `cmd /c echo x > ${marker}`, 'node -e "process.exit()"', '$(whoami)']) {
      const r = await req(port, 'POST', '/api/command', { body: { text }, headers: T });
      assert.equal(r.body.result.ok, false, text);
    }
    assert.equal(fs.existsSync(marker), false);
    await req(port, 'POST', '/api/command', { body: { text: 'help' }, headers: T });
    const logs = await req(port, 'GET', '/api/logs?source=bridge&after=0', { headers: T });
    assert.ok(logs.body.lines.some((l) => l.text.includes('不是系统终端')));
    assert.ok(logs.body.lines.some((l) => l.text.includes('未知命令')));
    assert.equal(cc.bridge.running, false);
  });
});

test('控制中心：选择 SnowLuma 目录不会启动它；无效目录拒绝；运行中不能迁移', async () => {
  await withCenter(async ({ cc, d, port, T }) => {
    const bad = await req(port, 'POST', '/api/snowluma/select', { body: { dir: path.join(d, 'nothing') }, headers: T });
    assert.equal(bad.status, 400);
    const sl = fakeSnowLuma(path.join(d, 'SnowLuma'), '1.14.22', { files: { 'config/runtime.json': JSON.stringify({ webuiPort: 1 }) } });
    const ok = await req(port, 'POST', '/api/snowluma/select', { body: { dir: sl }, headers: T });
    assert.equal(ok.body.ok, true);
    assert.equal(cc.snowluma.running, false, '选择目录不等于启动');
    const st = await req(port, 'GET', '/api/state', { headers: T });
    assert.equal(st.body.snowluma.info.version, '1.14.22');
    assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'state', 'control-center.json'), 'utf8')).snowlumaDir, sl);
  });
});

test('控制中心：选择目录时同步 config.json 的 snowluma.homeDir（保留其他字段）', async () => {
  await withCenter(async ({ d, port, T }) => {
    const sl = fakeSnowLuma(path.join(d, 'SnowLuma'), '1.14.22', { files: { 'config/runtime.json': JSON.stringify({ webuiPort: 1 }) } });
    const r = await req(port, 'POST', '/api/snowluma/select', { body: { dir: sl }, headers: T });
    assert.equal(r.body.homeDirSynced, true);
    const cfg = JSON.parse(fs.readFileSync(path.join(d, 'config.json'), 'utf8'));
    assert.equal(cfg.snowluma.homeDir, sl);
    assert.equal(cfg.snowluma.wsUrl, 'ws://127.0.0.1:3001');
    assert.equal(cfg.ownerQQ, 12345678);
  }, { config: { ownerQQ: 12345678, snowluma: { wsUrl: 'ws://127.0.0.1:3001' } } });
});

// ── 合规不变量（SnowLuma EULA v1.1 §5.4）─────────────────────────────────────
test('L6：AI 可达的代码里没有 SnowLuma 进程控制；控制中心不下载/不解压/不自动启动 SnowLuma', () => {
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const code = (p) => read(p).split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  for (const f of ['src/bridge.js', 'src/mcp-snowluma-safe.js', 'src/mcp-host-server.js', 'src/mcp-web-search-safe.js', 'src/bridge-extensions.js']) {
    const c = code(f);
    for (const bad of ['launcher.bat', 'snowlumaLaunchSpec', 'launcher/', 'start_snowluma', 'stop_snowluma']) {
      assert.ok(!c.includes(bad), `${f} 不得包含「${bad}」（AI 可达路径不得控制 SnowLuma 进程）`);
    }
  }
  const install = code('src/launcher/snowluma-install.mjs');
  for (const bad of ['browser_download_url', 'Expand-Archive', 'unzip', "'tar'", 'createWriteStream']) {
    assert.ok(!install.includes(bad), `snowluma-install.mjs 不得包含「${bad}」（不下载/不解压 SnowLuma 发行包）`);
  }
  const cc = code('src/launcher/control-center.mjs');
  // 启动 SnowLuma 只能出现在 HTTP 处理（/api/snowluma/start）与固定命令 snowluma start 里。
  const starts = cc.split('\n').filter((l) => l.includes('snowluma.start('));
  assert.equal(starts.length, 2, starts.join('\n'));
  assert.ok(cc.includes("shouldRestart: () => false, // 不自动拉起 SnowLuma"), 'SnowLuma 崩溃后不自动重启');
});
