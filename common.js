// 公共工具：popup 与 manager 共用
'use strict';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

// 由字符串派生稳定的头像底色
function avatarColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return `hsl(${h}, 62%, 52%)`;
}

function letterOf(text) {
  const t = (text || '?').trim();
  return t ? t[0].toUpperCase() : '?';
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 将书签树平铺为书签数组（跳过根节点与文件夹）
function flattenTree(nodes, parentTitle, out) {
  for (const node of nodes) {
    if (node.url) {
      out.push({
        id: node.id,
        title: node.title || node.url,
        url: node.url,
        dateAdded: node.dateAdded || 0,
        parentTitle: parentTitle || '未分组'
      });
    } else if (node.children) {
      flattenTree(node.children, node.title, out);
    }
  }
}

function loadBookmarks() {
  return new Promise((resolve) => {
    chrome.bookmarks.getTree((tree) => {
      const list = [];
      flattenTree(tree, '', list);
      resolve(list);
    });
  });
}

// 网络层可达性探测（多策略，降低误报）：
// 1) no-cors GET：只能判断网络层是否可达，无法识别 HTTP 404/500；
// 2) favicon 图片探测：某些站点/代理环境下 fetch 栈异常，用 <img> 加载器绕过；
// 3) GET 重试一次：排除瞬时网络抖动。
// 任一策略成功即判定可达。
function fetchProbe(url, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  return fetch(url, {
    method: 'GET',
    mode: 'no-cors',
    cache: 'no-store',
    redirect: 'follow',
    signal: ctrl.signal
  })
    .then(() => { clearTimeout(timer); return 'ok'; })
    .catch(() => { clearTimeout(timer); return 'bad'; });
}

function imgProbe(url, timeout) {
  return new Promise((resolve) => {
    let done = false;
    const img = new Image();
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      img.src = '';
      resolve(r);
    };
    const timer = setTimeout(() => finish('bad'), timeout);
    img.onload = () => finish('ok');
    img.onerror = () => finish('bad');
    img.src = url + (url.includes('?') ? '&' : '?') + '_bw=' + Date.now();  // 防缓存
  });
}

async function probe(url, timeout = 10000) {
  if (await fetchProbe(url, timeout) === 'ok') return 'ok';
  let origin;
  try { origin = new URL(url).origin; } catch (e) { return 'bad'; }
  if (await imgProbe(origin + '/favicon.ico', timeout) === 'ok') return 'ok';
  return fetchProbe(url, timeout);
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['settings'], (res) => {
      resolve(res.settings || { sort: 'date_desc', groupByFolder: true, lastCheck: null });
    });
  });
}

function setSettings(partial) {
  return getSettings().then((s) => {
    const next = Object.assign({}, s, partial);
    return new Promise((resolve) => chrome.storage.local.set({ settings: next }, () => resolve(next)));
  });
}

// 按节点子树生成 Netscape HTML（用于选择性导出：保留分组层级）
function exportNodeHtml(node, indent) {
  if (node.url) {
    const add = Math.floor((node.dateAdded || Date.now()) / 1000);
    return `${indent}<DT><A HREF="${escapeHtml(node.url)}" ADD_DATE="${add}">${escapeHtml(node.title)}</A>\n`;
  }
  let s = `${indent}<DT><H3 ADD_DATE="${Math.floor(Date.now() / 1000)}">${escapeHtml(node.title || '未命名')}</H3>\n${indent}<DL><p>\n`;
  for (const c of node.children || []) s += exportNodeHtml(c, indent + '    ');
  s += `${indent}</DL><p>\n`;
  return s;
}

// 选择性导出：nodes 为裁剪后的顶层节点数组（文件夹子树或单个书签），
// 保留原有分组层级结构
function exportHtmlFromNodes(nodes) {
  const stamp = new Date().toISOString();
  let body = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n' +
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n' +
    '<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n' +
    `    <DT><H3 ADD_DATE="${Math.floor(Date.now() / 1000)}">书签管家导出 ${stamp}</H3>\n    <DL><p>\n`;
  nodes.forEach((n) => { body += exportNodeHtml(n, '        '); });
  body += '    </DL><p>\n</DL><p>\n';
  const blob = new Blob([body], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bookmarks-' + formatDate(Date.now()) + '.html';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// 按勾选集合裁剪书签树：勾选文件夹→整棵子树保留；
// 未勾选文件夹但勾选其中部分书签→仅保留勾选的书签（层级不变）
function pruneTree(node, checkedSet) {
  if (node.url) return checkedSet.has(node.id) ? node : null;
  if (checkedSet.has(node.id)) return node;
  const children = (node.children || [])
    .map((c) => pruneTree(c, checkedSet))
    .filter(Boolean);
  if (children.length === 0) return null;
  return Object.assign({}, node, { children });
}

// 统计文件夹内书签总数（含子级）
function countBookmarks(node) {
  if (!node || !node.children) return 0;
  return node.children.reduce((n, c) => n + (c.url ? 1 : countBookmarks(c)), 0);
}

// 渲染导出勾选树（弹窗与管理页共用，保证两边导出选项完全一致）：
// 勾选分组 → 导出该分组整棵子树；展开分组只勾部分书签 → 仅导出勾选项（保留层级）
function renderExportTreeHtml(roots) {
  function renderNode(node) {
    if (node.url) {
      return `<div class="exp-row leaf">
        <input type="checkbox" class="exp-ck" data-id="${node.id}" />
        <span class="exp-name" title="${escapeHtml(node.title)}">${escapeHtml(node.title)}</span>
      </div>`;
    }
    const bm = node.children.filter((c) => c.url);
    const folders = node.children.filter((c) => !c.url);
    const inner = folders.map(renderNode).join('') + bm.map(renderNode).join('');
    return `<details class="exp-folder" open>
      <summary>
        <input type="checkbox" class="exp-ck exp-folder-ck" data-id="${node.id}" />
        📁 ${escapeHtml(node.title || '未命名')}
        <span class="count">(${countBookmarks(node)})</span>
      </summary>
      <div class="exp-children">${inner}</div>
    </details>`;
  }
  return roots.filter((r) => !r.url && r.children).map(renderNode).join('')
    || '<div class="empty">暂无书签</div>';
}

// 导出树勾选联动：勾选文件夹 → 勾选其全部后代
function bindExportChecks(container) {
  container.querySelectorAll('.exp-folder-ck').forEach((ck) => {
    ck.addEventListener('change', () => {
      const box = ck.closest('details');
      box.querySelectorAll('.exp-ck').forEach((c) => { c.checked = ck.checked; });
    });
  });
}

// 按勾选集合执行选择性导出；返回是否已触发导出
function exportFromChecked(roots, checkedSet) {
  if (checkedSet.size === 0) { alert('请至少勾选一个分组或书签'); return false; }
  const nodes = roots.map((r) => pruneTree(r, checkedSet)).filter(Boolean);
  if (nodes.length === 0) { alert('勾选项无有效内容可导出'); return false; }
  exportHtmlFromNodes(nodes);
  return true;
}

// 导出 Netscape 书签 HTML（全部书签，平铺）
function exportHtml(bookmarks) {
  const stamp = new Date().toISOString();
  let body = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n' +
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n' +
    '<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n' +
    `    <DT><H3 ADD_DATE="${Math.floor(Date.now() / 1000)}">书签管家导出 ${stamp}</H3>\n    <DL><p>\n`;
  bookmarks.forEach((b) => {
    const add = Math.floor((b.dateAdded || Date.now()) / 1000);
    body += `        <DT><A HREF="${escapeHtml(b.url)}" ADD_DATE="${add}">${escapeHtml(b.title)}</A>\n`;
  });
  body += '    </DL><p>\n</DL><p>\n';
  const blob = new Blob([body], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bookmarks-' + formatDate(Date.now()) + '.html';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// 包装 chrome.bookmarks.create 为 Promise
function createBM(opts) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.create(opts, (node) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(node);
    });
  });
}

// 批量导入 Netscape 书签 HTML：解析 <A HREF> 与文件夹 <H3>/<DL> 层级，
// 整体导入到一个按日期命名的新分组下，避免污染既有书签。返回导入条目数。
async function importFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const stamp = new Date().toLocaleString('zh-CN', { hour12: false }).replace(/[/\s:]/g, '-');
  const rootFolder = await createBM({ parentId: '1', title: '导入书签-' + stamp });

  let count = 0;
  async function walk(dl, parentId) {
    const dts = Array.from(dl.children).filter((el) => el.tagName === 'DT');
    for (const dt of dts) {
      const h3 = dt.querySelector(':scope > H3');
      const a = dt.querySelector(':scope > A');
      if (h3) {
        const childDl = dt.querySelector(':scope > DL');
        if (childDl) {
          const folder = await createBM({ parentId, title: h3.textContent.trim() || '导入分组' });
          await walk(childDl, folder.id);
        }
      } else if (a) {
        const url = a.getAttribute('href');
        if (!url || !/^(https?:|ftp:|file:)/i.test(url)) continue;
        await createBM({ parentId, title: a.textContent.trim() || url, url });
        count++;
      }
    }
  }

  const rootDl = doc.querySelector('DL');
  if (rootDl) await walk(rootDl, rootFolder.id);
  return count;
}

// 触发文件选择并执行导入（在 popup / manager 中调用）
function pickAndImport(onDone) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.html,.htm,text/html';
  inp.addEventListener('change', () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      importFromHtml(reader.result)
        .then((n) => { if (onDone) onDone(n); })
        .catch((e) => { alert('导入失败：' + (e && e.message ? e.message : e)); if (onDone) onDone(0); });
    };
    reader.readAsText(file);
  });
  inp.click();
}

