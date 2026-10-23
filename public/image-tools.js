export function initImageTools({ requestJson, documentRef = document, windowRef = window }) {
  const root = documentRef.getElementById('module-image-tools');
  const byId = (name) => root.querySelector(`#image-tools-${name}`);
  const folder = byId('folder');
  const select = byId('select');
  const start = byId('start');
  const open = byId('open');
  const status = byId('status');
  const skipped = byId('skipped');
  let state = null;
  let busy = '';
  let loading = null;
  let timer = null;
  let submittedSelectionId = '';
  let recovering = false;
  let errorMessage = '';

  function request(action, options = {}) {
    return requestJson(`/api/image-tools/${action}`, {
      ...options, headers: { 'X-Image-Tools': '1' },
    });
  }

  function render() {
    const selection = state?.selection;
    const job = state?.job;
    const running = job?.status === 'running';
    const unavailable = !state?.runtime.available;
    const waiting = Boolean(busy || loading);
    folder.value = selection?.folder || '';
    select.disabled = waiting || running || recovering || unavailable;
    start.disabled = waiting || running || unavailable || !selection?.count
      || Boolean(job) || submittedSelectionId === selection?.id;
    open.disabled = waiting || unavailable || !selection;
    select.textContent = busy === 'select' ? '选择中…' : '选择文件夹';
    start.textContent = busy === 'start' || running ? '正在处理…' : '开始处理';
    root.setAttribute('aria-busy', String(waiting || running));
    status.dataset.kind = '';
    if (errorMessage) {
      status.textContent = errorMessage;
      status.dataset.kind = 'error';
    } else if (!state) {
      status.textContent = loading ? '正在读取本机图片工具…' : '打开本页后读取图片工具状态。';
    } else if (unavailable) {
      status.textContent = state.runtime.message;
      status.dataset.kind = 'error';
    } else if (running) {
      const progress = job.progress;
      status.textContent = progress
        ? `正在处理 ${progress.done} / ${progress.total}${progress.name ? `：${progress.name}` : ''}`
        : '正在准备处理图片…';
    } else if (job?.status === 'completed') {
      status.textContent = `处理完成：已处理 ${job.result.completed} 张，跳过 ${job.result.skipped.length} 项。图片已在原文件夹内更新为 JPG 800 × 800，并依次命名为 1.jpg、2.jpg…。再次处理请重新选择文件夹。`;
      status.dataset.kind = job.result.skipped.length ? 'warning' : 'success';
    } else if (job?.status === 'failed') {
      status.textContent = `处理失败：${job.error}。请重新选择文件夹后再处理。`;
      status.dataset.kind = 'error';
    } else if (busy === 'select') {
      status.textContent = '请在系统窗口中选择图片文件夹。取消后保留原选择。';
    } else if (busy === 'start') {
      status.textContent = '正在开始处理图片…';
    } else if (submittedSelectionId === selection?.id) {
      status.textContent = '本次处理请求已发送，请重新选择文件夹后再处理。';
    } else if (selection) {
      status.textContent = selection.count
        ? `已找到 ${selection.count} 张图片，点击“开始处理”后将直接修改原文件夹中的图片。`
        : '当前文件夹没有可处理的图片，请重新选择文件夹。';
    } else {
      status.textContent = '先选择图片所在的文件夹，再开始处理。';
    }
    const rows = (job?.result?.skipped || []).map(([name, reason]) => {
      const row = documentRef.createElement('li');
      row.textContent = `${name}：${reason}`;
      return row;
    });
    skipped.replaceChildren(...rows);
    skipped.hidden = rows.length === 0;
  }

  function schedulePoll() {
    if (timer !== null) windowRef.clearTimeout(timer);
    timer = null;
    if (state?.job?.status === 'running' || recovering) {
      timer = windowRef.setTimeout(() => { timer = null; return load(); }, 750);
    }
  }

  async function load() {
    if (loading) return loading;
    if (busy) return;
    loading = (async () => {
      try {
        state = await request('state', { cache: 'no-store' });
        errorMessage = '';
        recovering = false;
      } catch (error) {
        const recovery = recovering ? '。正在恢复状态，请勿重复开始。'
          : state?.job?.status === 'running' ? '。正在继续读取处理进度。' : '。请重新打开本页重试。';
        errorMessage = `读取图片工具状态失败：${error.message}${recovery}`;
      }
    })();
    render();
    await loading;
    loading = null;
    render();
    schedulePoll();
  }

  select.addEventListener('click', async () => {
    if (select.disabled) return;
    busy = 'select';
    errorMessage = '';
    render();
    try {
      state = await request('select', { method: 'POST', body: '{}' });
      if (state.selection?.id !== submittedSelectionId) submittedSelectionId = '';
    } catch (error) {
      errorMessage = `选择文件夹失败：${error.message}`;
    } finally {
      busy = '';
      render();
      schedulePoll();
    }
  });

  start.addEventListener('click', async () => {
    if (start.disabled) return;
    const selectionId = state.selection.id;
    submittedSelectionId = selectionId;
    busy = 'start';
    errorMessage = '';
    render();
    try {
      state = await request('start', { method: 'POST', body: JSON.stringify({ selectionId }) });
    } catch (error) {
      recovering = true;
      busy = '';
      await load();
      if (!state?.job && !recovering) {
        errorMessage = `未能开始处理：${error.message}。请重新选择文件夹后再处理。`;
      }
    } finally {
      busy = '';
      render();
      schedulePoll();
    }
  });

  open.addEventListener('click', async () => {
    if (open.disabled) return;
    busy = 'open';
    errorMessage = '';
    render();
    try {
      await request('open', { method: 'POST', body: JSON.stringify({ selectionId: state.selection.id }) });
    } catch (error) {
      errorMessage = `打开文件夹失败：${error.message}`;
    } finally {
      busy = '';
      render();
      schedulePoll();
    }
  });

  render();
  return { load };
}
