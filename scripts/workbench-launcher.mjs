import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function workbenchUrl(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('工作台端口无效');
  return `http://127.0.0.1:${port}/`;
}

export async function startWorkbench({
  rootDir = projectRoot,
  port = Number(process.env.ICBU_WORKBENCH_PORT || 54025),
  fetchImpl = fetch,
  spawnImpl = spawn,
  waitImpl = wait,
} = {}) {
  const url = workbenchUrl(port);
  async function healthy() {
    try {
      const response = await fetchImpl(`${url}api/health`, {
        cache: 'no-store', signal: AbortSignal.timeout(1000),
      });
      const body = response.ok ? await response.json() : null;
      return body?.ok === true ? body : null;
    } catch {
      return false;
    }
  }
  function openBrowser() {
    const browser = spawnImpl('cmd.exe', ['/d', '/c', 'start', '', url], {
      windowsHide: true, detached: true, stdio: 'ignore',
    });
    browser.once('error', () => console.error(`浏览器未能自动打开，请访问 ${url}`));
    browser.unref();
  }
  function requireBackground(status) {
    if (status.background !== true) throw new Error('检测到前台或旧版工作台仍在运行，请先完成当前操作并关闭旧启动窗口，再重新启动。未创建第二个服务。');
  }
  const existing = await healthy();
  if (existing) {
    requireBackground(existing);
    openBrowser();
    return;
  }
  const child = spawnImpl(process.execPath, [path.join(rootDir, 'src/server.js')], {
    cwd: rootDir, detached: true, windowsHide: true, stdio: 'ignore',
    env: { ...process.env, ICBU_WORKBENCH_PORT: String(port), ICBU_WORKBENCH_BACKGROUND: '1' },
  });
  let spawnError;
  child.once('error', (error) => { spawnError = error; });
  child.unref();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (spawnError) throw new Error(`后台服务启动失败：${spawnError.code || '无法启动 Node.js'}`);
    const status = await healthy();
    if (status) {
      requireBackground(status);
      openBrowser();
      return;
    }
    await waitImpl(250);
  }
  throw new Error('后台服务未能就绪，请查看 data/runtime/server.log。未自动重启或发布商品。');
}

export async function stopWorkbench({
  port = Number(process.env.ICBU_WORKBENCH_PORT || 54025),
  fetchImpl = fetch,
} = {}) {
  const response = await fetchImpl(`${workbenchUrl(port)}api/workbench/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-workbench-control': 'stop' },
    body: JSON.stringify({ confirmed: true }),
    signal: AbortSignal.timeout(3000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) throw new Error(body.error || '工作台未接受停止请求');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const action = process.argv[2] || 'start';
    if (action === 'start') {
      await startWorkbench();
      console.log('工作台已在独立后台运行，关闭此窗口或浏览器不会停止服务。');
    } else if (action === 'stop') {
      await stopWorkbench();
      console.log('已请求正常停止工作台，正在等待当前本机请求结束。');
    } else throw new Error('只支持 start 或 stop');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
