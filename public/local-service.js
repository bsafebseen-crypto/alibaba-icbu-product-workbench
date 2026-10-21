export function initLocalServiceConnection({
  documentRef = document,
  windowRef = window,
  fetchImpl = fetch,
} = {}) {
  const sidebar = documentRef.getElementById('service-state');
  const localState = documentRef.getElementById('top-local-state');
  const topState = localState.closest('.top-state');

  function setConnected(connected) {
    sidebar.classList.toggle('connected', connected);
    topState.classList.toggle('connected', connected);
    sidebar.lastElementChild.textContent = connected ? '本地服务已连接' : '本地服务未连接';
    localState.textContent = connected ? '已连接' : '未连接';
  }

  async function requestJson(url, options = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
    } catch (cause) {
      setConnected(false);
      throw Object.assign(new Error(
        '本地服务连接中断，请重新打开“国际站运营工作台”以启动后台服务。若已提交上传或发布，请勿重复操作，等待结果核验。',
        { cause },
      ), { localServiceUnavailable: true });
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `请求失败（HTTP ${response.status}）`);
      Object.assign(error, body, { status: response.status });
      throw error;
    }
    return body;
  }

  let checking = false;
  async function checkHealth() {
    if (checking) return;
    checking = true;
    try {
      const result = await requestJson('/api/health', {
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
      });
      setConnected(result.ok === true);
    } catch {
      setConnected(false);
    } finally {
      checking = false;
    }
  }

  checkHealth();
  windowRef.setInterval(checkHealth, 5000);
  return { requestJson };
}
