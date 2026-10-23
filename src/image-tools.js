import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const bridgeFile = fileURLToPath(new URL('../tools/image-batch/bridge.py', import.meta.url));
const installationHelp = '请安装带 tkinter 的 Python 3.10 或以上版本及 Pillow，并执行：py -3 -m pip install -r tools/image-batch/requirements.txt；安装后重新启动工作台。';
const terminalTypes = { check: 'ready', select: 'selection', process: 'result', open: 'opened' };

function runBridge(command, action, payload, onEvent) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, [...command.prefix, '-X', 'utf8', bridgeFile, action], {
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let pending = '';
    let stderr = '';
    let terminal;
    let protocolError;

    function receive(line) {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        if (event.type === 'progress') onEvent?.(event);
        else terminal = event;
      } catch {
        protocolError = new Error('本地图片工具返回了无效结果，请重新选择文件夹后检查。');
      }
    }

    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      pending += chunk;
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        receive(pending.slice(0, end));
        pending = pending.slice(end + 1);
      }
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr = (stderr + chunk).slice(0, 8192);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      receive(pending);
      if (protocolError) return reject(protocolError);
      if (terminal?.type === 'error') return reject(new Error(terminal.message));
      if (code !== 0) return reject(new Error(stderr.trim() || '本地图片工具未能完成操作。'));
      if (terminal?.type !== terminalTypes[action]) return reject(new Error('本地图片工具未返回操作结果。'));
      resolve(terminal);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

function createPythonRunner() {
  let command;
  return async (action, payload, onEvent) => {
    if (action === 'check') {
      const candidates = process.platform === 'win32'
        ? [{ executable: 'py', prefix: ['-3'] }, { executable: 'python', prefix: [] }]
        : [{ executable: 'python3', prefix: [] }, { executable: 'python', prefix: [] }];
      let failure;
      for (const candidate of candidates) {
        try {
          const result = await runBridge(candidate, action, payload);
          command = candidate;
          return result;
        } catch (error) {
          if (!failure || error.code !== 'ENOENT') failure = error;
        }
      }
      throw failure;
    }
    if (!command) throw new Error(installationHelp);
    return runBridge(command, action, payload, onEvent);
  };
}

export function createImageToolsService({ runPython = createPythonRunner() } = {}) {
  let runtime = { available: false, message: '尚未检查本地图片工具运行环境。' };
  let runtimeCheck;
  let selection = null;
  let consumed = false;
  let job = null;
  let selecting = false;

  function snapshot() {
    return structuredClone({ runtime, selection, job });
  }

  function isBusy() {
    return selecting || job?.status === 'running';
  }

  function assertIdle() {
    if (isBusy()) throw Object.assign(new Error('正在选择文件夹或处理图片，请等待完成。'), { status: 409 });
  }

  function selectedFolder(selectionId) {
    if (typeof selectionId !== 'string' || !selection || selection.id !== selectionId) {
      throw Object.assign(new Error('请先通过本机选择器选择图片文件夹。'), { status: 400 });
    }
    return selection.folder;
  }

  async function checkRuntime() {
    runtimeCheck ??= Promise.resolve().then(() => runPython('check', {})).then((event) => {
      if (event?.type !== 'ready') throw new Error(event?.message || '本地图片工具运行环境检查失败。');
      runtime = { available: true, message: `Python ${event.python} / Pillow ${event.pillow} 已就绪` };
    }).catch((error) => {
      runtime = { available: false, message: `${error.message || '本地图片工具不可用。'}\n${installationHelp}` };
    });
    await runtimeCheck;
  }

  async function requireRuntime() {
    await checkRuntime();
    if (!runtime.available) throw Object.assign(new Error(runtime.message), { status: 503 });
  }

  async function getState() {
    await checkRuntime();
    return snapshot();
  }

  async function selectFolder() {
    assertIdle();
    selecting = true;
    try {
      await requireRuntime();
      const event = await runPython('select', {});
      if (event.folder) {
        selection = { id: randomUUID(), folder: event.folder, count: event.count };
        consumed = false;
        job = null;
      }
      return snapshot();
    } finally {
      selecting = false;
    }
  }

  async function start(selectionId) {
    assertIdle();
    await requireRuntime();
    assertIdle();
    const folder = selectedFolder(selectionId);
    if (consumed) throw Object.assign(new Error('这个文件夹选择已处理，请重新选择后再执行。'), { status: 409 });
    if (!selection.count) throw Object.assign(new Error('文件夹中没有支持的图片，请重新选择。'), { status: 400 });
    consumed = true;
    job = { id: randomUUID(), status: 'running', progress: null, result: null, error: '' };
    const currentJob = job;

    Promise.resolve().then(() => runPython('process', { folder }, (event) => {
      if (event.type === 'progress') {
        currentJob.progress = { done: event.done, total: event.total, name: event.name };
      }
    })).then((event) => {
      if (event?.type !== 'result') throw new Error(event?.message || '图片处理未返回结果。');
      currentJob.result = { folder: event.folder, completed: event.completed, skipped: event.skipped };
      currentJob.status = 'completed';
    }).catch((error) => {
      currentJob.status = 'failed';
      currentJob.error = error.message || '图片处理失败，请检查原文件夹。';
    });
    return snapshot();
  }

  async function openFolder(selectionId) {
    const folder = selectedFolder(selectionId);
    await requireRuntime();
    await runPython('open', { folder });
    return { ok: true };
  }

  return { getState, selectFolder, start, openFolder, isBusy };
}
