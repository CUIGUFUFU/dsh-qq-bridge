#!/usr/bin/env node
// qq-bridge 控制中心：一个只监听本机回环的小网页，把「桥接终端」和「SnowLuma 终端」合到一个页面里。
//
// 用法：双击仓库根目录的 control-center.bat（有窗口）或 control-center-hidden.vbs（无窗口），
//      或 `npm run control-center`。启动后自动打开浏览器（--no-open 关闭）。
//
// 设计要点：
//   · 控制中心是**外壳进程**：桥接与 SnowLuma 都是它的子进程。桥接崩溃或被停止时，页面仍然可用。
//   · 启动控制中心**不会**启动桥接，更**不会**启动 SnowLuma —— 两者都只在用户点击按钮时启动。
//     SnowLuma 崩溃后也不自动重启（自动拉起 = 自动启动，违背「只由用户点击」）。
//   · 不下载、不安装、不修改 SnowLuma 的任何程序文件；更新只做「检查版本 + 打开下载页 + 迁移用户数据」
//     （SnowLuma EULA v1.1 §5.4，见 snowluma-install.mjs 头注释）。
//   · 页面令牌：state/control-center-token（首次启动生成）。浏览器通过地址的 #t=… 片段拿到令牌
//     （片段不会发给服务器、不进日志），之后每个请求带 x-control-token 头。只接受本机 Host、JSON、同源请求。
//   · 左侧的「命令」是**固定命令集**（status / mode / panic …），不是 shell —— 不能执行任意程序。
//   · 退出控制中心会先优雅停止它启动的子进程（子进程的输出管道依附于控制中心）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createManagedProcess } from './managed-process.mjs';
import { inspectSnowLumaDir, snowlumaLaunchSpec, checkSnowLumaUpdate, migrateSnowLumaData, pickFolderDialog, SNOWLUMA_RELEASES_PAGE } from './snowluma-install.mjs';
import { redactCredentials, redactKnown } from '../lib/redact.mjs';
import { atomicWriteJsonFile, readJsonFile } from '../lib/json-store.js';
import { resolveDshBaseUrl } from '../lib/dsh-endpoint.mjs';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// 路径都按「项目根目录」计算；离线测试可以传入临时根目录（见 scripts/test-control-center.mjs）。
let ROOT = DEFAULT_ROOT;
let STATE_DIR, SETTINGS_FILE, TOKEN_FILE, LOCK_FILE, LOG_DIR, PAGE_FILE, VERSION;
function setRoot(root) {
  ROOT = path.resolve(root);
  STATE_DIR = path.join(ROOT, 'state');
  SETTINGS_FILE = path.join(STATE_DIR, 'control-center.json');
  TOKEN_FILE = path.join(STATE_DIR, 'control-center-token');
  LOCK_FILE = path.join(STATE_DIR, 'control-center.lock');
  LOG_DIR = path.join(STATE_DIR, 'logs');
  PAGE_FILE = path.join(DEFAULT_ROOT, 'public', 'control-center.html');
  VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return 'unknown'; } })();
}
setRoot(DEFAULT_ROOT);

// ── 小工具 ────────────────────────────────────────────────────────────────────

function readJson(file, fallback = null) {
  const r = readJsonFile(file);
  return r.ok ? r.value : fallback;
}
function readText(file) { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; } }
function tokenEq(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
function portOpen(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v) => { try { s.destroy(); } catch {} resolve(v); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; }
}
function openBrowser(url) {
  if (process.platform === 'win32') {
    // 用 url.dll 的协议处理器打开默认浏览器：不经过 cmd 的引号/元字符解析。
    execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe'), ['url.dll,FileProtocolHandler', url], { windowsHide: true }, () => {});
  } else if (process.platform === 'darwin') {
    execFile('open', [url], () => {});
  } else {
    execFile('xdg-open', [url], () => {});
  }
}

// ── 设置与令牌 ────────────────────────────────────────────────────────────────

function loadSettings() {
  return { port: 3099, snowlumaDir: '', autoRestartBridge: true, ...(readJson(SETTINGS_FILE, {}) ?? {}) };
}
function saveSettings(s) { atomicWriteJsonFile(SETTINGS_FILE, s); }
function loadOrCreateToken() {
  const t = readText(TOKEN_FILE);
  if (/^[a-f0-9]{48}$/.test(t)) return t;
  const n = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, n, { mode: 0o600 });
  return n;
}

// ── 桥接配置（可能还不存在：未部署时也要能打开控制中心）────────────────────────

function bridgeConfig() {
  const r = readJsonFile(path.join(ROOT, 'config.json'));
  if (r.missing) return { exists: false, valid: false, error: '还没有 config.json（尚未部署）。部署时会从 config.example.json 复制并填写；见 docs/DSH_DEPLOYMENT.md 第 7 节。' };
  if (!r.ok || !r.value || typeof r.value !== 'object') return { exists: true, valid: false, error: `config.json 无法解析：${r.error?.message ?? r.error}` };
  return { exists: true, valid: true, value: r.value };
}
function consoleToken(cfg) {
  const fromCfg = String(cfg?.consoleToken ?? '').trim();
  return fromCfg || readText(path.join(STATE_DIR, 'console-token'));
}
function consolePort(cfg) { return Number(cfg?.consolePort) > 0 ? Number(cfg.consolePort) : 3100; }

async function bridgeApi(route, { method = 'GET', body } = {}) {
  const cfg = bridgeConfig();
  if (!cfg.valid) throw new Error(cfg.error);
  const token = consoleToken(cfg.value);
  if (!token) throw new Error('还没有控制台令牌（桥接首次启动后生成 state/console-token）');
  const res = await fetch(`http://127.0.0.1:${consolePort(cfg.value)}${route}`, {
    method,
    headers: { 'x-console-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && data?.ok !== false) throw new Error(`HTTP ${res.status}`);
  return data;
}

function dshVersion() {
  // 桌面版 DSH：%USERPROFILE%\.dsh\dsh-runtimes\*\runtime.json 的 desktopVersion（只读这个文件，不碰凭据）。
  const base = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'dsh-runtimes');
  try {
    for (const d of fs.readdirSync(base)) {
      const v = readJson(path.join(base, d, 'runtime.json'))?.desktopVersion;
      if (v) return `${v}（桌面版）`;
    }
  } catch {}
  return null;
}

// ── 主程序 ────────────────────────────────────────────────────────────────────

export async function startControlCenter({ open = true, port: portOverride = null, root = null, bridgeEntry = null, installSignalHandlers = true, exitOnShutdown = true, log = (m) => console.log(`[控制中心] ${m}`) } = {}) {
  if (root) setRoot(root);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const settings = loadSettings();
  // portOverride=0：由系统分配空闲端口（离线测试用）。
  const port = portOverride === 0 ? 0 : (Number(portOverride ?? process.env.QQ_BRIDGE_CONTROL_PORT ?? settings.port) || 3099);
  const token = loadOrCreateToken();
  const pageUrl = `http://127.0.0.1:${port}/#t=${token}`;

  // 单实例：已有控制中心在跑就直接打开它的页面。
  const lock = readJson(LOCK_FILE);
  if (lock?.pid && lock.pid !== process.pid && pidAlive(lock.pid) && await portOpen(lock.port || port)) {
    log(`控制中心已在运行（PID ${lock.pid}），直接打开页面`);
    if (open) openBrowser(`http://127.0.0.1:${lock.port || port}/#t=${token}`);
    return { alreadyRunning: true };
  }

  const secrets = () => {
    const cfg = bridgeConfig();
    return [token, consoleToken(cfg.value), String(cfg.value?.snowluma?.accessToken ?? ''), String(cfg.value?.dsh?.authToken ?? '')].filter(Boolean);
  };
  const redact = (line) => redactCredentials(redactKnown(line, secrets()));

  let snowInfo = settings.snowlumaDir ? inspectSnowLumaDir(settings.snowlumaDir) : { ok: false, error: '未选择 SnowLuma 目录' };
  let updateInfo = null;
  let lastMigration = null;

  const bridge = createManagedProcess({
    name: 'bridge',
    logDir: LOG_DIR,
    redact,
    resolveLaunch: () => {
      const cfg = bridgeConfig();
      if (!cfg.valid) return { error: cfg.error };
      if (!fs.existsSync(path.join(ROOT, 'node_modules'))) return { error: '还没有安装依赖：请在项目目录运行 npm ci' };
      return { command: process.execPath, args: [bridgeEntry ?? path.join(ROOT, 'src', 'bridge.js')], cwd: ROOT, env: { QQ_BRIDGE_SUPERVISED: '1' }, display: 'node src/bridge.js' };
    },
    // 退出码 2 = 已有另一个桥接实例（锁文件），1 且无配置 = 配置问题：重启也没用。
    shouldRestart: ({ code }) => code !== 0 && code !== 2 && bridgeConfig().valid,
    gracefulStop: async () => { try { await bridgeApi('/api/admin/shutdown', { method: 'POST', body: {} }); return true; } catch { return false; } },
  });
  bridge.setAutoRestart(settings.autoRestartBridge !== false);

  const snowluma = createManagedProcess({
    name: 'snowluma',
    logDir: LOG_DIR,
    redact,
    resolveLaunch: () => {
      snowInfo = settings.snowlumaDir ? inspectSnowLumaDir(settings.snowlumaDir) : { ok: false, error: '未选择 SnowLuma 目录' };
      return snowlumaLaunchSpec(snowInfo);
    },
    shouldRestart: () => false, // 不自动拉起 SnowLuma
  });

  async function health() {
    const cfg = bridgeConfig();
    const out = { config: { exists: cfg.exists, valid: cfg.valid, error: cfg.error ?? null } };
    out.bridgeApi = null;
    if (cfg.valid) {
      try { out.bridgeApi = await bridgeApi('/api/status'); } catch (e) { out.bridgeApiError = String(e?.message ?? e); }
    }
    // dsh.baseUrl 留空 = 自动识别（桌面版 19387 / 命令行版 3080）
    const dshUrl = (await resolveDshBaseUrl(cfg.value?.dsh?.baseUrl ?? '', { timeoutMs: 400 })).url;
    try {
      const u = new URL(dshUrl);
      out.dsh = { url: dshUrl, reachable: await portOpen(Number(u.port) || 80, u.hostname === 'localhost' ? '127.0.0.1' : u.hostname) };
    } catch { out.dsh = { url: dshUrl, reachable: false }; }
    out.dsh.version = dshVersion();
    out.consolePort = consolePort(cfg.value);
    // SnowLuma：自己启动的看进程；用户在外面自己开的看 WebUI 端口。
    out.snowlumaPort = snowInfo.ok ? await portOpen(snowInfo.webui.port) : false;
    out.bridgeExternal = !bridge.running && consoleToken(cfg.value) ? await portOpen(consolePort(cfg.value)) : false;
    return out;
  }

  async function stateSnapshot() {
    const h = await health();
    return {
      version: VERSION,
      node: process.versions.node,
      platform: process.platform,
      root: ROOT,
      bridge: { ...bridge.snapshot(), lastSeq: bridge.lastSeq },
      snowluma: { ...snowluma.snapshot(), lastSeq: snowluma.lastSeq, dir: settings.snowlumaDir || null, info: snowInfo, update: updateInfo, lastMigration, releasesPage: SNOWLUMA_RELEASES_PAGE },
      health: h,
    };
  }

  // ── 固定命令集 ──────────────────────────────────────────────────────────────
  const HELP = [
    '可用命令（不是系统终端，只能执行下面这些）：',
    '  status                     桥接当前模式、级别、DSH/SnowLuma 连通情况',
    '  mode <chat|reserved|reserved2|closed-agent> [L1|L2|L3] [TOTP]   切换模式（同控制台规则：L3 要 TOTP）',
    '  panic                      紧急关闭：立即回到安全模式',
    '  approvals                  查看待审批',
    '  audit [条数]               最近的管理审计记录',
    '  reconcile                  立刻重新对账群成员名单',
    '  bridge start|stop|restart  启停桥接',
    '  snowluma start|stop        启停 SnowLuma',
    '  clear                      清空本页面的显示（不删除日志文件）',
  ].join('\n');

  async function runCommand(text) {
    const parts = String(text ?? '').trim().split(/\s+/).filter(Boolean);
    const [cmd, a1, a2, a3] = parts;
    const say = (m) => bridge.note(`> ${parts.join(' ')}\n${m}`);
    switch ((cmd ?? '').toLowerCase()) {
      case '': return { ok: true };
      case 'help': case '?': say(HELP); return { ok: true };
      case 'clear': return { ok: true, clear: true };
      case 'status': {
        const s = await bridgeApi('/api/admin/status').catch((e) => ({ text: `桥接接口不可用：${e.message}` }));
        say(s.text ?? JSON.stringify(s));
        return { ok: true };
      }
      case 'mode': {
        if (!a1) { say('用法：mode <chat|reserved|reserved2|closed-agent> [L1|L2|L3] [TOTP]'); return { ok: false }; }
        const r = await bridgeApi('/api/mode', { method: 'POST', body: { mode: a1, ...(a2 ? { level: a2.toUpperCase() } : {}), ...(a3 ? { totp: a3 } : {}) } }).catch((e) => ({ ok: false, error: e.message }));
        say(r.ok ? `已切换：${r.mode} / ${r.level}` : `切换失败：${r.error}`);
        return { ok: !!r.ok };
      }
      case 'panic': {
        const r = await bridgeApi('/api/admin/panic', { method: 'POST', body: {} }).catch((e) => ({ ok: false, error: e.message }));
        say(r.ok ? `已紧急关闭：${r.mode} / ${r.level}` : `失败：${r.error}`);
        return { ok: !!r.ok };
      }
      case 'approvals': {
        const r = await bridgeApi('/api/admin/status').catch((e) => ({ approvals: [], error: e.message }));
        say(r.error ? r.error : (r.approvals?.length ? r.approvals.map((x) => `#${x.id} ${x.key} ${x.toolName}`).join('\n') : '没有待审批（审批只能由 owner 在 QQ 里回复「通过 #编号」）'));
        return { ok: true };
      }
      case 'audit': {
        const n = Math.max(1, Math.min(100, Number(a1) || 20));
        const r = await bridgeApi(`/api/admin/audit?limit=${n}`).catch((e) => ({ entries: [], error: e.message }));
        say(r.error ? r.error : [`哈希链：${r.chain?.ok ? '完整' : '不一致'}`, ...r.entries.map((x) => `${x.time} ${x.event} ${x.source ?? ''}`)].join('\n'));
        return { ok: true };
      }
      case 'reconcile': {
        const r = await bridgeApi('/api/people/reconcile', { method: 'POST', body: {} }).catch((e) => ({ ok: false, error: e.message }));
        say(r.ok ? `对账完成：${JSON.stringify(r.results)}` : `失败：${r.error}`);
        return { ok: !!r.ok };
      }
      case 'bridge': {
        if (a1 === 'start') { const r = bridge.start(); return r; }
        if (a1 === 'stop') return bridge.stop();
        if (a1 === 'restart') { await bridge.stop(); return bridge.start(); }
        say('用法：bridge start|stop|restart'); return { ok: false };
      }
      case 'snowluma': {
        if (a1 === 'start') return snowluma.start();
        if (a1 === 'stop') return snowluma.stop();
        say('用法：snowluma start|stop'); return { ok: false };
      }
      default:
        say(`未知命令「${cmd}」。输入 help 查看可用命令。`);
        return { ok: false };
    }
  }

  // ── HTTP ────────────────────────────────────────────────────────────────────
  const SEC = {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  };
  const allowedHosts = () => [`127.0.0.1:${server.address()?.port ?? port}`, `localhost:${server.address()?.port ?? port}`];

  async function readBody(req) {
    const chunks = [];
    let n = 0;
    for await (const c of req) { n += c.length; if (n > 256 * 1024) throw Object.assign(new Error('请求体过大'), { status: 413 }); chunks.push(c); }
    const t = Buffer.concat(chunks).toString('utf8');
    if (!t.trim()) return {};
    const v = JSON.parse(t);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw Object.assign(new Error('请求体必须是 JSON 对象'), { status: 400 });
    return v;
  }

  const server = http.createServer(async (req, res) => {
    const send = (status, obj, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'content-type': type, ...SEC });
      res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
    };
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (!allowedHosts().includes(String(req.headers.host ?? '').toLowerCase())) return send(403, { ok: false, error: '只接受本机访问' });
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        let html;
        try { html = fs.readFileSync(PAGE_FILE, 'utf8'); } catch { return send(500, '控制中心页面缺失：public/control-center.html', 'text/plain; charset=utf-8'); }
        return send(200, html, 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204, SEC); return res.end(); }
      if (!url.pathname.startsWith('/api/')) return send(404, { ok: false, error: '不存在' });
      if (!tokenEq(req.headers['x-control-token'], token)) return send(401, { ok: false, error: '需要控制中心令牌（见 state/control-center-token）' });
      if (req.method !== 'GET') {
        if (!String(req.headers['content-type'] ?? '').includes('application/json')) return send(415, { ok: false, error: '请求必须是 application/json' });
        const origin = req.headers.origin;
        if (origin) { let h = ''; try { h = new URL(String(origin)).host; } catch {} if (!allowedHosts().includes(h)) return send(403, { ok: false, error: '跨站请求被拒绝' }); }
      }
      const body = req.method === 'POST' ? await readBody(req) : {};
      const p = url.pathname;

      if (req.method === 'GET' && p === '/api/state') return send(200, { ok: true, ...(await stateSnapshot()) });
      if (req.method === 'GET' && p === '/api/logs') {
        const src = url.searchParams.get('source') === 'snowluma' ? snowluma : bridge;
        return send(200, { ok: true, lines: src.linesSince(Number(url.searchParams.get('after')) || 0, 2000), lastSeq: src.lastSeq });
      }
      if (req.method === 'POST' && p === '/api/bridge/start') { bridge.resetRestarts(); return send(200, bridge.start()); }
      if (req.method === 'POST' && p === '/api/bridge/stop') return send(200, await bridge.stop());
      if (req.method === 'POST' && p === '/api/bridge/restart') { await bridge.stop(); bridge.resetRestarts(); return send(200, bridge.start()); }
      if (req.method === 'POST' && p === '/api/bridge/auto-restart') {
        settings.autoRestartBridge = body.enabled === true;
        bridge.setAutoRestart(settings.autoRestartBridge);
        saveSettings(settings);
        return send(200, { ok: true, autoRestart: settings.autoRestartBridge });
      }
      if (req.method === 'POST' && p === '/api/command') {
        const r = await runCommand(body.text);
        return send(200, { ok: true, result: r });
      }
      if (req.method === 'POST' && p === '/api/snowluma/pick') {
        const picked = await pickFolderDialog({ initialDir: settings.snowlumaDir || ROOT });
        return send(200, { ok: true, dir: picked });
      }
      if (req.method === 'POST' && p === '/api/snowluma/inspect') {
        return send(200, { ok: true, info: inspectSnowLumaDir(body.dir) });
      }
      if (req.method === 'POST' && p === '/api/snowluma/select') {
        if (snowluma.running) return send(409, { ok: false, error: '请先停止 SnowLuma 再更换目录' });
        const info = inspectSnowLumaDir(body.dir);
        if (!info.ok) return send(400, { ok: false, error: info.error });
        settings.snowlumaDir = info.dir;
        saveSettings(settings);
        snowInfo = info;
        updateInfo = null;
        // 顺手把桥接配置里的 snowluma.homeDir 对齐（token 自愈要从它的 config/onebot_<QQ>.json 读）。
        let homeDirSynced = false;
        const cfg = bridgeConfig();
        if (cfg.valid && body.syncBridgeHomeDir !== false && cfg.value?.snowluma?.homeDir !== info.dir) {
          try {
            const next = { ...cfg.value, snowluma: { ...(cfg.value.snowluma ?? {}), homeDir: info.dir } };
            atomicWriteJsonFile(path.join(ROOT, 'config.json'), next);
            homeDirSynced = true;
          } catch {}
        }
        snowluma.note(`已选择 SnowLuma 目录：${info.dir}（${info.version}，${info.edition === 'full' ? '完整版' : 'Lite 版'}）${homeDirSynced ? '；已同步 config.json 的 snowluma.homeDir（重启桥接后生效）' : ''}`);
        return send(200, { ok: true, info, homeDirSynced });
      }
      if (req.method === 'POST' && p === '/api/snowluma/start') {
        if (!snowluma.running && snowInfo.ok && await portOpen(snowInfo.webui.port)) {
          return send(409, { ok: false, error: `端口 ${snowInfo.webui.port} 已被占用：SnowLuma 可能已经在别处运行（例如你手动双击了 launcher.bat）。请先关掉那个，再从这里启动。` });
        }
        return send(200, snowluma.start());
      }
      if (req.method === 'POST' && p === '/api/snowluma/stop') return send(200, await snowluma.stop());
      if (req.method === 'POST' && p === '/api/snowluma/check-update') {
        if (!snowInfo.ok) return send(400, { ok: false, error: '请先选择 SnowLuma 目录' });
        try {
          updateInfo = { ...(await checkSnowLumaUpdate(snowInfo.version)), checkedAt: Date.now() };
          return send(200, { ok: true, update: updateInfo });
        } catch (e) {
          return send(502, { ok: false, error: `检查更新失败：${e?.message ?? e}` });
        }
      }
      if (req.method === 'POST' && p === '/api/snowluma/open-download') {
        openBrowser(updateInfo?.pageUrl || SNOWLUMA_RELEASES_PAGE);
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && p === '/api/snowluma/migrate') {
        if (snowluma.running || (snowInfo.ok && await portOpen(snowInfo.webui.port))) return send(409, { ok: false, error: '迁移前必须先停止 SnowLuma（数据文件在被写入时复制可能不完整）' });
        if (!settings.snowlumaDir) return send(400, { ok: false, error: '还没有选择当前（旧）SnowLuma 目录' });
        const r = migrateSnowLumaData({ fromDir: settings.snowlumaDir, toDir: body.toDir, backupRoot: path.join(STATE_DIR, 'snowluma-backups'), includeLogs: body.includeLogs === true });
        lastMigration = { ...r, at: Date.now() };
        if (r.ok && body.switchTo !== false) {
          const info = inspectSnowLumaDir(body.toDir);
          settings.snowlumaDir = info.dir;
          saveSettings(settings);
          snowInfo = info;
          updateInfo = null;
          const cfg = bridgeConfig();
          if (cfg.valid) {
            try { atomicWriteJsonFile(path.join(ROOT, 'config.json'), { ...cfg.value, snowluma: { ...(cfg.value.snowluma ?? {}), homeDir: info.dir } }); } catch {}
          }
        }
        snowluma.note(r.ok ? `数据迁移完成：${r.from} → ${r.to}，已备份到 ${r.backupDir}` : `数据迁移失败：${r.error}`);
        return send(r.ok ? 200 : 400, r);
      }
      if (req.method === 'POST' && p === '/api/snowluma/open-webui') {
        if (!snowInfo.ok) return send(400, { ok: false, error: '请先选择 SnowLuma 目录' });
        openBrowser(snowInfo.webui.url);
        return send(200, { ok: true, url: snowInfo.webui.url });
      }
      if (req.method === 'POST' && p === '/api/exit') {
        send(200, { ok: true });
        setTimeout(() => { void shutdown('页面上点击了「退出控制中心」'); }, 100);
        return;
      }
      return send(404, { ok: false, error: '不存在的接口' });
    } catch (error) {
      try { send(error?.status ?? 500, { ok: false, error: String(error?.message ?? error) }); } catch {}
    }
  });

  let shuttingDown = false;
  async function shutdown(reason) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`正在退出（${reason}）：先停止由控制中心启动的进程…`);
    await Promise.allSettled([bridge.stop(), snowluma.stop()]);
    try { const l = readJson(LOCK_FILE); if (l?.pid === process.pid) fs.unlinkSync(LOCK_FILE); } catch {}
    await new Promise((r) => server.close(r));
    if (exitOnShutdown) process.exit(0);
  }
  if (installSignalHandlers) {
    process.on('SIGINT', () => { void shutdown('Ctrl+C'); });
    process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
    process.on('SIGHUP', () => { void shutdown('窗口关闭'); });
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  }).catch((error) => {
    if (error?.code === 'EADDRINUSE') throw new Error(`端口 ${port} 被占用。可在 state/control-center.json 里改 "port"，或设置环境变量 QQ_BRIDGE_CONTROL_PORT`);
    throw error;
  });
  atomicWriteJsonFile(LOCK_FILE, { pid: process.pid, port: server.address().port, startedAt: Date.now() });
  bridge.note(`控制中心 v${VERSION} 已启动。桥接尚未启动 —— 点击「启动桥接」（或在下方输入 bridge start）。`);
  if (!bridgeConfig().valid) bridge.note(bridgeConfig().error);
  snowluma.note(snowInfo.ok ? `SnowLuma 目录：${snowInfo.dir}（${snowInfo.version}）。未启动 —— 需要时点击「启动 SnowLuma」。` : '尚未选择 SnowLuma 目录。');
  log(`已启动：http://127.0.0.1:${server.address().port}/  （令牌在 state/control-center-token）`);
  if (open) openBrowser(`http://127.0.0.1:${server.address().port}/#t=${token}`);
  return { server, bridge, snowluma, token, port: server.address().port, shutdown, runCommand, settings, pageUrl };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startControlCenter({ open: !process.argv.includes('--no-open') }).catch((error) => {
    console.error(`[控制中心] 启动失败：${error?.message ?? error}`);
    process.exit(1);
  });
}
