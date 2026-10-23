import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readyState = (changes = {}) => ({
  runtime: { available: true, message: '' },
  selection: { id: 'selection-1', folder: 'C:\\test images', count: 3 },
  job: null,
  ...changes,
});

function element() {
  const listeners = new Map();
  const attributes = new Map();
  return {
    textContent: '', value: '', disabled: false, hidden: false, dataset: {}, children: [],
    set innerHTML(_value) { throw new Error('Use textContent for local paths and filenames'); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name); },
    addEventListener(name, callback) { listeners.set(name, callback); },
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    click() { return listeners.get('click')?.(); },
  };
}

async function setup(requestJson) {
  const { initImageTools } = await import('../public/image-tools.js');
  const ids = ['module-image-tools', 'image-tools-folder', 'image-tools-select', 'image-tools-start',
    'image-tools-open', 'image-tools-status', 'image-tools-skipped'];
  const elements = Object.fromEntries(ids.map((id) => [id, element()]));
  elements['module-image-tools'].querySelector = (selector) => elements[selector.slice(1)];
  const timers = new Map();
  let nextTimer = 0;
  const windowRef = {
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const calls = [];
  const controller = initImageTools({
    requestJson: async (url, options = {}) => {
      calls.push({ url, options });
      return requestJson(url, options);
    },
    documentRef: { getElementById: (id) => elements[id], createElement: () => element() },
    windowRef,
  });
  const tick = async () => {
    const [id, callback] = timers.entries().next().value;
    timers.delete(id);
    await callback();
  };
  return { controller, calls, timers, tick, elements };
}

test('image tools add one compact source chooser inside the existing workbench', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /data-module="keyword-records"[\s\S]*?data-module="image-tools"[\s\S]*?data-module="1688-publishing"/);
  assert.match(html, /data-module="obsidian-publishing"[^>]*aria-current="page"/);
  const page = html.match(/<section class="module-page" id="module-image-tools"[\s\S]*?(?=      <section class="module-page")/)?.[0] || '';
  assert.match(page, /id="image-tools-folder"[^>]*readonly/);
  assert.equal([...page.matchAll(/<input\b/g)].length, 1);
  assert.match(page, /id="image-tools-select"/);
  assert.match(page, /id="image-tools-start"/);
  assert.match(page, /id="image-tools-open"/);
  assert.match(page, /id="image-tools-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.doesNotMatch(page, /type="file"|type="checkbox"|<select\b|<progress\b|输出文件夹|裁剪|填充/);
  assert.match(app, /if \(moduleName === 'image-tools'\) imageToolsController\.load\(\)/);
});

test('module initialization is passive and navigation recovers a running job without restarting it', async () => {
  let state = readyState({ job: {
    id: 'job-1', status: 'running', progress: { done: 1, total: 3, name: 'front.jpg' },
    result: null, error: '',
  } });
  const ui = await setup(async () => state);
  assert.equal(ui.calls.length, 0);
  await ui.controller.load();
  assert.match(ui.elements['image-tools-status'].textContent, /1\s*\/\s*3/);
  assert.match(ui.elements['image-tools-status'].textContent, /front\.jpg/);
  assert.equal(ui.elements['image-tools-start'].disabled, true);
  assert.equal(ui.elements['image-tools-select'].disabled, true);
  assert.equal(ui.elements['module-image-tools'].getAttribute('aria-busy'), 'true');
  assert.equal(ui.timers.size, 1);
  await ui.controller.load();
  assert.equal(ui.timers.size, 1);
  state = readyState({ job: {
    id: 'job-1', status: 'completed', progress: null,
    result: { folder: 'C:\\test images', completed: 3, skipped: [] }, error: '',
  } });
  await ui.tick();
  assert.equal(ui.timers.size, 0);
  assert.match(ui.elements['image-tools-status'].textContent, /已处理 3/);
  assert.equal(ui.elements['image-tools-start'].disabled, true);
  assert.equal(ui.elements['image-tools-select'].disabled, false);
  assert.equal(ui.elements['module-image-tools'].getAttribute('aria-busy'), 'false');
  assert.ok(ui.calls.every(({ url, options }) => url === '/api/image-tools/state'
    && options.headers['X-Image-Tools'] === '1' && !options.method));
});

test('native folder selection sends no path, cancellation preserves selection and opening uses its token', async () => {
  const ui = await setup(async (url) => url.endsWith('/open') ? { ok: true } : readyState());
  await ui.controller.load();
  await ui.elements['image-tools-select'].click();
  assert.equal(ui.elements['image-tools-folder'].value, 'C:\\test images');
  assert.equal(ui.elements['image-tools-start'].disabled, false);
  const selection = ui.calls.find(({ url }) => url.endsWith('/select'));
  assert.equal(selection.options.method, 'POST');
  assert.deepEqual(JSON.parse(selection.options.body), {});
  await ui.elements['image-tools-open'].click();
  const open = ui.calls.find(({ url }) => url.endsWith('/open'));
  assert.deepEqual(JSON.parse(open.options.body), { selectionId: 'selection-1' });
  assert.ok(ui.calls.every(({ options }) => options.headers['X-Image-Tools'] === '1'));
  assert.equal(ui.calls.filter(({ url }) => url.endsWith('/start')).length, 0);
});

test('start sends one request even while its first reply is pending and never reuses a completed selection', async () => {
  let reply;
  const ui = await setup((url) => url.endsWith('/start')
    ? new Promise((resolve) => { reply = resolve; }) : readyState());
  await ui.controller.load();
  const starting = ui.elements['image-tools-start'].click();
  await ui.elements['image-tools-start'].click();
  assert.equal(ui.calls.filter(({ url }) => url.endsWith('/start')).length, 1);
  assert.deepEqual(JSON.parse(ui.calls.at(-1).options.body), { selectionId: 'selection-1' });
  reply(readyState({ job: {
    id: 'job-1', status: 'completed', progress: null,
    result: { folder: 'C:\\test images', completed: 3, skipped: [] }, error: '',
  } }));
  await starting;
  await ui.elements['image-tools-start'].click();
  assert.equal(ui.calls.filter(({ url }) => url.endsWith('/start')).length, 1);
  assert.equal(ui.elements['image-tools-start'].disabled, true);
});

test('a lost start reply recovers with GET state and never retries the processing request', async () => {
  let started = false;
  const ui = await setup(async (url) => {
    if (url.endsWith('/start')) { started = true; throw new TypeError('Connection lost'); }
    return readyState({ job: started ? {
      id: 'job-1', status: 'running', progress: { done: 0, total: 3, name: '' },
      result: null, error: '',
    } : null });
  });
  await ui.controller.load();
  await ui.elements['image-tools-start'].click();
  assert.deepEqual(ui.calls.map(({ url }) => url), [
    '/api/image-tools/state', '/api/image-tools/start', '/api/image-tools/state',
  ]);
  assert.equal(ui.elements['image-tools-start'].disabled, true);
  assert.equal(ui.timers.size, 1);
  await ui.tick();
  assert.equal(ui.calls.filter(({ url }) => url.endsWith('/start')).length, 1);
});

test('unavailable runtime and failed jobs explain recovery and require reselection', async () => {
  let state = readyState({ runtime: { available: false, message: '请安装 Pillow' }, selection: null });
  const ui = await setup(async () => state);
  await ui.controller.load();
  assert.match(ui.elements['image-tools-status'].textContent, /请安装 Pillow/);
  assert.equal(ui.elements['image-tools-select'].disabled, true);
  assert.equal(ui.elements['image-tools-start'].disabled, true);
  state = readyState({ job: { id: 'job-1', status: 'failed', progress: null, result: null, error: '无法写入图片' } });
  await ui.controller.load();
  assert.match(ui.elements['image-tools-status'].textContent, /无法写入图片/);
  assert.match(ui.elements['image-tools-status'].textContent, /重新选择/);
  assert.equal(ui.elements['image-tools-start'].disabled, true);
  state = readyState({ selection: { id: 'selection-2', folder: 'C:\\next', count: 2 } });
  await ui.elements['image-tools-select'].click();
  assert.equal(ui.elements['image-tools-start'].disabled, false);
});

test('a lost start and failed recovery keep the folder locked until a later state read succeeds', async () => {
  let lost = false;
  let recovered = false;
  const ui = await setup(async (url) => {
    if (url.endsWith('/start')) { lost = true; throw new TypeError('Connection lost'); }
    if (lost && !recovered) throw new TypeError('Service restarting');
    return readyState({ job: recovered ? {
      id: 'job-1', status: 'running', progress: null, result: null, error: '',
    } : null });
  });
  await ui.controller.load();
  await ui.elements['image-tools-start'].click();
  assert.equal(ui.elements['image-tools-select'].disabled, true);
  assert.equal(ui.elements['image-tools-start'].disabled, true);
  assert.match(ui.elements['image-tools-status'].textContent, /恢复状态/);
  assert.equal(ui.timers.size, 1);
  recovered = true;
  await ui.tick();
  assert.match(ui.elements['image-tools-status'].textContent, /准备处理/);
  assert.equal(ui.calls.filter(({ url }) => url.endsWith('/start')).length, 1);
});

test('paths, skipped names and backend errors render as text without HTML interpretation', async () => {
  const unsafe = '<img src=x onerror=alert(1)>';
  const ui = await setup(async () => readyState({
    selection: { id: 'selection-1', folder: unsafe, count: 3 },
    job: { id: 'job-1', status: 'completed', progress: null, error: '',
      result: { folder: unsafe, completed: 2, skipped: [[unsafe, '不支持的图片']] } },
  }));
  await ui.controller.load();
  assert.equal(ui.elements['image-tools-folder'].value, unsafe);
  assert.match(ui.elements['image-tools-skipped'].children[0].textContent, /<img src=x/);
  assert.match(ui.elements['image-tools-status'].textContent, /跳过 1/);
});
