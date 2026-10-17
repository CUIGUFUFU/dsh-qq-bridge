// DSH Web API 地址的自动识别（v0.4.1）。
//
// 事实（对照 DSH 桌面版 0.2.0-rc.2 安装包 resources/app.asar）：桌面版启动内置服务时写死 `--port 19387`，
// 运行 `desktop` profile；命令行版 `dsh web` 默认 3080。部署实测踩过「文档默认 3080，桌面版实际 19387」。
//
// 规则：config.json 的 dsh.baseUrl **显式填写**时一律照用；留空（或缺省）时自动识别：
//   1. 检测到桌面版（~/.dsh/dsh-runtimes/*/runtime.json 有 desktopVersion）→ 候选顺序 19387、3080，否则 3080、19387；
//   2. 异步版本（resolveDshBaseUrl）按顺序试 TCP 连接，第一个能连上的胜出；都连不上时用第一个候选。

import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';

export const DSH_CLI_PORT = 3080;
export const DSH_DESKTOP_PORT = 19387;

export function dshHomeDir(env = process.env) {
  return env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

/** 是否装了 DSH 桌面版；返回桌面版版本号或 null。只读 runtime.json，不碰凭据。 */
export function detectDshDesktop(env = process.env) {
  const base = path.join(dshHomeDir(env), 'dsh-runtimes');
  try {
    for (const d of fs.readdirSync(base)) {
      try {
        const v = JSON.parse(fs.readFileSync(path.join(base, d, 'runtime.json'), 'utf8')).desktopVersion;
        if (v) return String(v);
      } catch {}
    }
  } catch {}
  return null;
}

/** 候选地址（按优先级）。configured 非空时只有它一个。 */
export function dshBaseUrlCandidates(configured, env = process.env) {
  const c = String(configured ?? '').trim();
  if (c) return [c.replace(/\/+$/, '')];
  const cli = `http://127.0.0.1:${DSH_CLI_PORT}`;
  const desktop = `http://127.0.0.1:${DSH_DESKTOP_PORT}`;
  return detectDshDesktop(env) ? [desktop, cli] : [cli, desktop];
}

function portOpen(url, timeoutMs) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { resolve(false); return; }
    const s = net.connect({ host: u.hostname === 'localhost' ? '127.0.0.1' : u.hostname, port: Number(u.port) || 80 });
    const done = (v) => { try { s.destroy(); } catch {} resolve(v); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/**
 * @returns {Promise<{url:string, auto:boolean, reachable:boolean, candidates:string[]}>}
 */
export async function resolveDshBaseUrl(configured, { env = process.env, timeoutMs = 800 } = {}) {
  const candidates = dshBaseUrlCandidates(configured, env);
  const auto = !String(configured ?? '').trim();
  for (const url of candidates) {
    if (await portOpen(url, timeoutMs)) return { url, auto, reachable: true, candidates };
  }
  return { url: candidates[0], auto, reachable: false, candidates };
}
