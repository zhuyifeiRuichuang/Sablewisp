// 后台 Service Worker（Manifest V3）
// 职责：安装初始化、提供「在线可达性检测」消息中枢。
// 在线检测通过 check-host.net 多节点 TCP 探测获取「全球可达性」结论，
// 规避本地网络异常导致的误判。Service Worker 的 fetch 不受扩展页 CORS 限制，
// 因此可读取第三方检测服务的响应（扩展页直接 fetch 会被 CORS 拦截）。

chrome.runtime.onInstalled.addListener(() => {
  // 初始化本地存储中的默认设置
  chrome.storage.local.get(['settings'], (res) => {
    if (!res.settings) {
      chrome.storage.local.set({
        settings: {
          sort: 'date_desc',     // date_desc | date_asc | url_asc | title_asc
          groupByFolder: true,
          lastCheck: null        // {time, total, bad: [{id,title,url,status}]}
        }
      });
    }
  });
});

// 在线检测最小请求间隔，缓解 check-host.net 免费接口限流（429）
let _lastCreate = 0;
async function _throttle(minGap) {
  const wait = _lastCreate + minGap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  _lastCreate = Date.now();
}

// 在线多节点 TCP 检测：返回 { verdict: 'up' | 'down' | 'error' }
// - up：至少一个探测节点成功建立 TCP 连接（全球可达）
// - down：所有节点均连接失败（全球不可达）
// - error：检测服务不可用 / 超时未能确认（交由本地探测兜底）
async function onlineCheck(url) {
  let host, scheme;
  try {
    const u = new URL(url);
    host = u.hostname;
    scheme = u.protocol === 'https:' ? 'https' : 'http';
  } catch (e) {
    return { verdict: 'error' };
  }
  if (!host) return { verdict: 'error' };

  const API = 'https://check-host.net';
  const checkUrl = `${API}/check-tcp?host=${encodeURIComponent(scheme + '://' + host)}&max_nodes=3`;

  // 创建检测任务（含一次重试以缓解瞬时限流）
  let requestId = null;
  for (let attempt = 0; attempt < 2 && !requestId; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1200));
    await _throttle(500);
    try {
      const resp = await fetch(checkUrl, {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data && data.request_id) requestId = data.request_id;
    } catch (e) { /* 重试 */ }
  }
  if (!requestId) return { verdict: 'error' };

  // 轮询结果（最多约 7 秒，直到所有节点返回或无 pending）
  const deadline = Date.now() + 7000;
  let last = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 900));
    try {
      const resp = await fetch(`${API}/check-result/${requestId}`, {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      last = data;
      const pending = Object.values(data).some((v) => v === null);
      if (!pending) break;
    } catch (e) { /* 继续轮询 */ }
  }
  if (!last) return { verdict: 'error' };

  // 判定：任一节点可达 → up；全部失败且均已结束 → down；
  // 仍有节点 pending 且无一成功 → error（不误判为网站故障，交由本地兜底）
  let anyReachable = false;
  let anyPending = false;
  for (const val of Object.values(last)) {
    if (val === null) { anyPending = true; continue; }
    if (Array.isArray(val)) {
      const ok = val.some((entry) =>
        entry && typeof entry === 'object' && !entry.error &&
        (entry.time !== undefined || entry.address)
      );
      if (ok) anyReachable = true;
    }
  }
  if (anyReachable) return { verdict: 'up' };
  if (anyPending) return { verdict: 'error' };
  return { verdict: 'down' };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 仅接受本扩展内部（popup / 管理页）发起的消息，阻断其它扩展或页面的调用
  if (!sender || sender.id !== chrome.runtime.id) return false;
  if (msg && msg.type === 'PING') {
    sendResponse({ pong: true });
    return false;
  }
  if (msg && msg.type === 'onlineCheck') {
    // 返回 Promise 以保持 Service Worker 在异步检测期间存活
    onlineCheck(msg.url).then((res) => sendResponse(res));
    return true;
  }
  return false;
});
