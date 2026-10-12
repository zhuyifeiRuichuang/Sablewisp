'use strict';

let TREE = [];
let ROOTS = [];
let ALL = [];
let STATUS = {};        // id -> 'ok' | 'bad' | 'checking'
let CHECKING = false;
let query = '';
let sort = 'date_desc';
let groupByFolder = true;

const $ = (id) => document.getElementById(id);
const content = $('content');

function leafMatch(b) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (b.title || '').toLowerCase().includes(q) || (b.url || '').toLowerCase().includes(q);
}
function folderHasMatch(node) {
  if (!node.children) return false;
  return node.children.some((c) => (c.url ? leafMatch(c) : folderHasMatch(c)));
}
function countBookmarks(node) {
  if (!node.children) return 0;
  return node.children.reduce((n, c) => n + (c.url ? 1 : countBookmarks(c)), 0);
}
// 仅统计当前搜索条件下可见的书签数量
function countVisible(node) {
  if (!node.children) return 0;
  let n = 0;
  for (const c of node.children) {
    if (c.url) { if (leafMatch(c)) n++; }
    else if (folderHasMatch(c)) n += countVisible(c);
  }
  return n;
}
function sortBookmarks(arr) {
  const a = arr.slice();
  if (sort === 'date_desc') a.sort((x, y) => (y.dateAdded || 0) - (x.dateAdded || 0));
  else if (sort === 'date_asc') a.sort((x, y) => (x.dateAdded || 0) - (y.dateAdded || 0));
  else if (sort === 'url_asc') a.sort((x, y) => domainOf(x.url).localeCompare(domainOf(y.url), 'zh'));
  else if (sort === 'title_asc') a.sort((x, y) => (x.title || '').localeCompare(y.title || '', 'zh'));
  return a;
}

function statusHtml(id) {
  const s = STATUS[id];
  if (s === 'checking') return '<span class="status checking"><span class="dot checking"></span>检测中</span>';
  if (s === 'bad') return '<span class="status bad">不可达</span>';
  if (s === 'ok') return '<span class="status ok"><span class="dot ok"></span>可达</span>';
  return '';
}

function renderBookmark(b) {
  const dom = domainOf(b.url) || b.url;
  const color = avatarColor(b.title + b.url);
  return `<div class="row" data-id="${b.id}">
    <div class="avatar" style="background:${color}">${escapeHtml(letterOf(b.title))}</div>
    <div class="meta">
      <div class="name" title="${escapeHtml(b.title)}">${escapeHtml(b.title)}</div>
      <div class="sub" title="${escapeHtml(b.url)}">${escapeHtml(dom)}</div>
    </div>
    ${statusHtml(b.id)}
    <span class="date">${formatDate(b.dateAdded)}</span>
    <div class="acts">
      <button class="open" data-id="${b.id}" data-url="${escapeHtml(b.url)}">打开</button>
      <button class="edit" data-id="${b.id}">编辑</button>
      <button class="del" data-id="${b.id}">删除</button>
    </div>
  </div>`;
}

function renderFolderNode(node) {
  const bm = node.children.filter((c) => c.url);
  const folders = node.children.filter((c) => !c.url);
  const sortedBM = sortBookmarks(bm);
  const sortedFolders = folders.slice().sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh'));

  let inner = '';
  for (const f of sortedFolders) {
    if (!folderHasMatch(f)) continue;
    inner += renderFolderNode(f);
  }
  for (const b of sortedBM) {
    if (!leafMatch(b)) continue;
    inner += renderBookmark(b);
  }
  if (!inner) return '';

  const total = countVisible(node);
  return `<details class="folder" open>
    <summary>
      📁 ${escapeHtml(node.title || '未命名')}
      <span class="count">(${total})</span>
      <span class="open-all" data-folder="${node.id}">打开全部</span>
    </summary>
    <div class="children">${inner}</div>
  </details>`;
}

function renderFlat() {
  const items = ALL.filter(leafMatch);
  const sorted = sortBookmarks(items);
  if (sorted.length === 0) return `<div class="empty">无匹配书签</div>`;
  return sorted.map(renderBookmark).join('');
}

function render() {
  if (groupByFolder) {
    const html = ROOTS.filter(folderHasMatch).map(renderFolderNode).join('');
    content.innerHTML = html || `<div class="empty">无匹配书签</div>`;
  } else {
    content.innerHTML = renderFlat();
  }
  bindRowEvents();
  renderBadPanel();
  updateStat();
}

function bindRowEvents() {
  content.querySelectorAll('.row').forEach((row) => {
    const id = row.getAttribute('data-id');
    row.querySelector('.open').addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.tabs.create({ url: row.querySelector('.open').getAttribute('data-url') });
    });
    row.querySelector('.edit').addEventListener('click', (e) => { e.stopPropagation(); openEdit(id); });
    row.querySelector('.del').addEventListener('click', (e) => { e.stopPropagation(); removeBookmark(id); });
  });
  content.querySelectorAll('.open-all').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openAllInFolder(el.getAttribute('data-folder'));
    });
  });
}

function openAllInFolder(folderId) {
  const node = findNode(ROOTS, folderId);
  if (!node) return;
  const urls = [];
  (function collect(n) {
    if (!n.children) return;
    n.children.forEach((c) => { if (c.url) urls.push(c.url); else collect(c); });
  })(node);
  urls.forEach((u) => chrome.tabs.create({ url: u }));
}

function findNode(list, id) {
  for (const n of list) {
    if (n.id === id) return n;
    if (n.children) { const f = findNode(n.children, id); if (f) return f; }
  }
  return null;
}

function removeBookmark(id) {
  if (!confirm('确定删除该书签？')) return;
  chrome.bookmarks.remove(id, () => { reload(); });
}

/* ---------- 编辑弹窗 ---------- */
let editId = null;
function openEdit(id) {
  const b = ALL.find((x) => x.id === id);
  if (!b) return;
  editId = id;
  $('editTitle').value = b.title;
  $('editUrl').value = b.url;
  $('modal').classList.remove('hidden');
  $('editTitle').focus();
}
function closeEdit() { $('modal').classList.add('hidden'); editId = null; }
function saveEdit() {
  if (!editId) return;
  const title = $('editTitle').value.trim();
  const url = $('editUrl').value.trim();
  if (!title || !/^https?:/i.test(url)) { alert('请输入有效标题与 http(s) 网址'); return; }
  chrome.bookmarks.update(editId, { title, url }, () => { closeEdit(); reload(); });
}

/* ---------- 不可达清单 ---------- */
function renderBadPanel() {
  const badIds = Object.keys(STATUS).filter((id) => STATUS[id] === 'bad');
  const panel = $('badPanel');
  if (badIds.length === 0) { panel.classList.add('hidden'); return; }
  const list = badIds
    .map((id) => ALL.find((x) => x.id === id))
    .filter((b) => b && leafMatch(b));
  if (list.length === 0 && query) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  $('badCount').textContent = `共 ${list.length} 个`;
  $('badAll').checked = false;
  $('badList').innerHTML = list.map((b) => `
    <li>
      <input type="checkbox" class="bad-ck" data-id="${b.id}" />
      <div class="meta">
        <div class="name" title="${escapeHtml(b.title)}">${escapeHtml(b.title)}</div>
        <div class="url" title="${escapeHtml(b.url)}">${escapeHtml(b.url)}</div>
      </div>
      <button class="btn ghost small" data-open="${escapeHtml(b.url)}">打开</button>
      <button class="btn ghost small" data-del="${b.id}">删除</button>
    </li>`).join('');
  $('badList').querySelectorAll('[data-open]').forEach((el) =>
    el.addEventListener('click', () => chrome.tabs.create({ url: el.getAttribute('data-open') })));
  $('badList').querySelectorAll('[data-del]').forEach((el) =>
    el.addEventListener('click', () => { chrome.bookmarks.remove(el.getAttribute('data-del'), () => reload()); }));
}

/* ---------- 不可达清单：勾选重检（不勾选则重检全部不可达） ---------- */
async function recheckBad() {
  if (CHECKING) return;
  const checkedIds = Array.from(document.querySelectorAll('#badList .bad-ck:checked'))
    .map((el) => el.getAttribute('data-id'));
  let list = Object.keys(STATUS)
    .filter((id) => STATUS[id] === 'bad')
    .map((id) => ALL.find((x) => x.id === id))
    .filter((b) => b && /^https?:/i.test(b.url));
  if (checkedIds.length) list = list.filter((b) => checkedIds.includes(b.id));
  if (list.length === 0) { alert('没有可重新检测的不可达书签'); return; }

  CHECKING = true;
  $('recheck').disabled = true;
  list.forEach((b) => { STATUS[b.id] = 'checking'; });
  render();

  const CONC = 6;
  let done = 0;
  async function worker() {
    while (done < list.length) {
      const b = list[done++];
      STATUS[b.id] = await probe(b.url);
      if (done % 5 === 0 || done === list.length) render();
    }
  }
  const pool = [];
  for (let i = 0; i < Math.min(CONC, list.length); i++) pool.push(worker());
  await Promise.all(pool);

  // 同步 lastCheck：保留仍不可达的 + 本次检出的新不可达
  const bad = Object.keys(STATUS)
    .filter((id) => STATUS[id] === 'bad')
    .map((id) => {
      const b = ALL.find((x) => x.id === id);
      return b ? { id: b.id, title: b.title, url: b.url } : null;
    })
    .filter(Boolean);
  await setSettings({ lastCheck: { time: Date.now(), total: ALL.filter((b) => /^https?:/i.test(b.url)).length, bad } });

  $('recheck').disabled = false;
  CHECKING = false;
  render();
}

function updateStat() {
  const folders = ROOTS.length;
  const bad = Object.keys(STATUS).filter((id) => STATUS[id] === 'bad').length;
  let s = `共 ${ALL.length} 个书签 · ${folders} 个分组`;
  if (bad) s += ` · 不可达 ${bad}`;
  $('stat').textContent = s;
}

/* ---------- 有效性检测 ---------- */
async function checkValidity() {
  if (CHECKING) return;
  const targets = ALL.filter((b) => /^https?:/i.test(b.url));
  if (targets.length === 0) return;
  if (!confirm('即将对 ' + targets.length + ' 个网页发起网络探测。\n\n注意：\n• 采用三重探测（no-cors GET → favicon 图片探测 → GET 重试）以降低误报；\n• 受浏览器安全策略(CORS)限制，本检测仅能判断「网络层是否可达」，无法准确识别 HTTP 404/500；\n• 无 favicon 且严格拦截探测的站点仍可能被误判，请在稳定网络环境下检测。')) {
    return;
  }
  CHECKING = true;
  $('check').disabled = true;
  // 重置状态
  STATUS = {};
  targets.forEach((b) => { STATUS[b.id] = 'checking'; });
  render();

  const bad = [];
  let done = 0;
  const CONC = 6;
  const prog = $('progress');
  prog.classList.remove('hidden');

  async function worker() {
    while (done < targets.length) {
      const i = done++;
      prog.textContent = `正在检测 ${i + 1} / ${targets.length} …`;
      const b = targets[i];
      const r = await probe(b.url);
      STATUS[b.id] = r;
      if (r === 'bad') bad.push({ id: b.id, title: b.title, url: b.url });
      // 节流刷新，避免频繁重排
      if (i % 10 === 0 || i === targets.length - 1) render();
    }
  }
  const pool = [];
  for (let i = 0; i < Math.min(CONC, targets.length); i++) pool.push(worker());
  await Promise.all(pool);

  await setSettings({ lastCheck: { time: Date.now(), total: targets.length, bad } });
  prog.classList.add('hidden');
  $('check').disabled = false;
  CHECKING = false;
  render();
}

/* ---------- 导出弹窗：全部 / 自定义（分组或分组内书签） ---------- */
function renderExpNode(node) {
  if (node.url) {
    return `<div class="exp-row leaf">
      <input type="checkbox" class="exp-ck" data-id="${node.id}" />
      <span class="exp-name" title="${escapeHtml(node.title)}">${escapeHtml(node.title)}</span>
    </div>`;
  }
  const bm = node.children.filter((c) => c.url);
  const folders = node.children.filter((c) => !c.url);
  let inner = folders.map(renderExpNode).join('') +
    bm.map(renderExpNode).join('');
  return `<details class="exp-folder" open>
    <summary>
      <input type="checkbox" class="exp-ck exp-folder-ck" data-id="${node.id}" />
      📁 ${escapeHtml(node.title || '未命名')}
      <span class="count">(${countBookmarks(node)})</span>
    </summary>
    <div class="exp-children">${inner}</div>
  </details>`;
}

function openExport() {
  $('expTree').innerHTML = ROOTS.filter((r) => !r.url && r.children)
    .map(renderExpNode).join('') || '<div class="empty">暂无书签</div>';
  $('exportModal').classList.remove('hidden');

  // 勾选文件夹 → 联动勾选其全部后代
  $('expTree').querySelectorAll('.exp-folder-ck').forEach((ck) => {
    ck.addEventListener('change', () => {
      const box = ck.closest('details');
      box.querySelectorAll('.exp-ck').forEach((c) => { c.checked = ck.checked; });
    });
  });
}

function doExport() {
  const mode = document.querySelector('input[name="expMode"]:checked').value;
  if (mode === 'all') {
    exportHtml(ALL);
  } else {
    const checked = new Set(Array.from($('expTree').querySelectorAll('.exp-ck:checked'))
      .map((el) => el.getAttribute('data-id')));
    if (checked.size === 0) { alert('请至少勾选一个分组或书签'); return; }
    const nodes = ROOTS.map((r) => pruneTree(r, checked)).filter(Boolean);
    exportHtmlFromNodes(nodes);
  }
  closeExport();
}

function closeExport() { $('exportModal').classList.add('hidden'); }

/* ---------- 初始化 ---------- */
function reload() {
  chrome.bookmarks.getTree((tree) => {
    TREE = tree;
    ROOTS = (tree[0] && tree[0].children) || [];
    const list = [];
    flattenTree(tree, '', list);
    ALL = list;
    render();
  });
}

function init() {
  getSettings().then((s) => {
    sort = s.sort || 'date_desc';
    groupByFolder = s.groupByFolder !== false;
    $('sort').value = sort;
    $('groupToggle').checked = groupByFolder;
    if (s.lastCheck && s.lastCheck.bad) {
      s.lastCheck.bad.forEach((b) => { STATUS[b.id] = 'bad'; });
    }
    reload();
  });

  $('q').addEventListener('input', (e) => { query = e.target.value.trim(); render(); });
  $('sort').addEventListener('change', (e) => {
    sort = e.target.value;
    setSettings({ sort });
    render();
  });
  $('groupToggle').addEventListener('change', (e) => {
    groupByFolder = e.target.checked;
    setSettings({ groupByFolder: groupByFolder });
    render();
  });

  $('refresh').addEventListener('click', reload);
  $('help').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('help.html') });
  });
  $('export').addEventListener('click', openExport);
  $('exportCancel').addEventListener('click', closeExport);
  $('exportDo').addEventListener('click', doExport);
  $('exportModal').addEventListener('click', (e) => { if (e.target === $('exportModal')) closeExport(); });
  document.querySelectorAll('input[name="expMode"]').forEach((r) => {
    r.addEventListener('change', () => {
      $('expTree').classList.toggle('hidden', r.value !== 'custom' || !r.checked);
    });
  });
  $('import').addEventListener('click', () => {
    pickAndImport((n) => { if (n) alert(`已批量导入 ${n} 个书签（含文件夹结构）`); reload(); });
  });
  $('check').addEventListener('click', checkValidity);
  $('recheck').addEventListener('click', recheckBad);
  $('badAll').addEventListener('change', (e) => {
    const on = e.target.checked;
    document.querySelectorAll('#badList .bad-ck').forEach((ck) => { ck.checked = on; });
  });
  $('toggleBad').addEventListener('click', () => {
    const p = $('badPanel');
    const hidden = p.querySelector('.bad-list').classList.toggle('hidden');
    $('toggleBad').textContent = hidden ? '展开' : '收起';
  });

  $('editCancel').addEventListener('click', closeEdit);
  $('editSave').addEventListener('click', saveEdit);
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeEdit(); });
}

document.addEventListener('DOMContentLoaded', init);
