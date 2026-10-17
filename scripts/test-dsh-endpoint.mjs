// v0.4.1 回归：DSH 地址自动识别。显式配置照用；留空时桌面版优先 19387，否则 3080；
// 异步版本挑第一个能连上的端口。用临时 DSH_HOME 和临时监听端口，不碰真实 DSH。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { dshBaseUrlCandidates, detectDshDesktop, resolveDshBaseUrl } from '../src/lib/dsh-endpoint.mjs';

function fakeHome({ desktop }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qqb-dshhome-'));
  if (desktop) {
    const d = path.join(home, 'dsh-runtimes', 'r1');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'runtime.json'), JSON.stringify({ desktopVersion: '0.2.0-rc.2' }));
  }
  return { DSH_HOME: home };
}

test('显式 baseUrl 照用（去掉末尾斜杠）', () => {
  assert.deepEqual(dshBaseUrlCandidates('http://127.0.0.1:19387/', fakeHome({ desktop: false })), ['http://127.0.0.1:19387']);
});

test('留空：桌面版优先 19387，命令行版优先 3080', () => {
  const desk = fakeHome({ desktop: true });
  assert.equal(detectDshDesktop(desk), '0.2.0-rc.2');
  assert.deepEqual(dshBaseUrlCandidates('', desk), ['http://127.0.0.1:19387', 'http://127.0.0.1:3080']);
  const cli = fakeHome({ desktop: false });
  assert.equal(detectDshDesktop(cli), null);
  assert.deepEqual(dshBaseUrlCandidates(undefined, cli), ['http://127.0.0.1:3080', 'http://127.0.0.1:19387']);
});

test('异步解析：显式地址能连上 → reachable；连不上 → 回退到第一个候选', async () => {
  const srv = net.createServer((s) => s.end());
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const ok = await resolveDshBaseUrl(url, { env: fakeHome({ desktop: false }) });
  assert.deepEqual([ok.url, ok.auto, ok.reachable], [url, false, true]);
  await new Promise((r) => srv.close(r));
  const bad = await resolveDshBaseUrl(url, { env: fakeHome({ desktop: false }), timeoutMs: 300 });
  assert.deepEqual([bad.url, bad.reachable], [url, false]);
});
