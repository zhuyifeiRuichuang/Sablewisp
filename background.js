// 后台 Service Worker（Manifest V3）
// 职责：安装初始化、接收来自管理页的消息以在后台执行批量有效性探测，
// 避免长时间任务受弹出层/页面生命周期影响。

chrome.runtime.onInstalled.addListener(() => {
  // 初始化本地存储中的默认设置
  chrome.storage.local.get(['settings'], (res) => {
    if (!res.settings) {
      chrome.storage.local.set({
        settings: {
          sort: 'date_desc',     // date_desc | date_asc | url_asc | title_asc
          groupByFolder: true,
          lastCheck: null        // {time, total, bad: [{id,title,url}]}
        }
      });
    }
  });
});

// 消息中枢：目前探测逻辑放在管理页内联执行（popup/manager 均为 extension page，
// 受 manifest 中 connect-src * 允许跨域 no-cors 探测）。此处预留转发能力。
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'PING') {
    sendResponse({ pong: true });
  }
  return false;
});
