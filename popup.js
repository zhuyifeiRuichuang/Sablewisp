'use strict';

let ALL = [];
let BAD_MAP = {};   // id -> true（来自上次检测）
let CHECKING = false;
let EXPANDED = new Set();   // 手动展开的分组名（默认全部折叠）

const $ = (id) => document.getElementById(id);
const listEl = $('list');
const statEl = $('stat');
const qEl = $('q');

function renderStat() {
  const bad = Object.keys(BAD_MAP).length;
  statEl.textContent = `共 ${ALL.length} 个书签` + (bad ? ` · 上次检测不可达 ${bad}` : '');
}

function badBadge(id) {
  const s = BAD_MAP[id];
  if (s === 'site_down') return '<span class="badge fault">网站故障</span>';
  if (s === 'local_unreachable') return '<span class="badge local">本地不可达</span>';
  return '<span class="badge bad">不可达</span>';
}

function itemHtml(b) {
  const dom = domainOf(b.url);
  const color = avatarColor(b.title + b.url);
  const badge = BAD_MAP[b.id] ? badBadge(b.id) : '';
  return `<li class="item" data-url="${escapeHtml(b.url)}">
    <div class="avatar" style="background:${color}">${escapeHtml(letterOf(b.title))}</div>
    <div class="meta">
      <div class="name">${escapeHtml(b.title)}</div>
      <div class="url">${escapeHtml(dom || b.url)}</div>
    </div>
    ${badge}
  </li>`;
}

function render() {
  const q = qEl.value.trim().toLowerCase();
  const scT = $('scTitle').checked;
  const scU = $('scUrl').checked;
  const scG = $('scGrp').checked;
  const items = ALL.filter((b) => {
    if (!q) return true;
    if (scT && b.title.toLowerCase().includes(q)) return true;
    if (scU && b.url.toLowerCase().includes(q)) return true;
    if (scG && (b.parentTitle || '').toLowerCase().includes(q)) return true;
    return false;
  });

  if (items.length === 0) {
    listEl.innerHTML = `<li class="empty">${q ? '无匹配书签' : '暂无书签'}</li>`;
    bindItemClick();
    return;
  }

  // 按父文件夹分组（保持出现顺序）
  const groups = [];
  const idx = {};
  for (const b of items) {
    if (!(b.parentTitle in idx)) {
      idx[b.parentTitle] = groups.length;
      groups.push({ name: b.parentTitle, items: [] });
    }
    groups[idx[b.parentTitle]].items.push(b);
  }

  listEl.innerHTML = groups.map((g) => {
    const collapsed = !q && !EXPANDED.has(g.name);   // 默认折叠；搜索时全部展开
    const inner = collapsed ? '' : g.items.map(itemHtml).join('');
    return `<li>
      <div class="grp-hd" data-grp="${escapeHtml(g.name)}">
        <span class="arrow">${collapsed ? '▶' : '▼'}</span>
        <span>${escapeHtml(g.name)}</span>
        <span class="cnt">${g.items.length}</span>
      </div>
      <ul class="grp-items">${inner}</ul>
    </li>`;
  }).join('');

  bindItemClick();

  listEl.querySelectorAll('.grp-hd').forEach((el) => {
    el.addEventListener('click', () => {
      const name = el.getAttribute('data-grp');
      if (EXPANDED.has(name)) EXPANDED.delete(name);
      else EXPANDED.add(name);
      render();
    });
  });
}

function bindItemClick() {
  listEl.querySelectorAll('.item').forEach((el) => {
    el.addEventListener('click', () => {
      openUrl(el.getAttribute('data-url'));   // 带协议校验，避免导航到不可打开的非常规地址
    });
  });
}

async function checkValidity() {
  if (CHECKING) return;
  CHECKING = true;
  const targets = ALL.filter((b) => /^https?:/i.test(b.url));
  if (targets.length === 0) { CHECKING = false; return; }
  if (!confirm('即将对 ' + targets.length + ' 个网页发起有效性检测。\n\n检测策略（规避本地网络误判）：\n• 本地四重探测：收到任何 HTTP 响应（含 Cloudflare 403 人机验证、429 限流）即判定「可达」，防护站不误判；\n• 本地打不开时，自动改用在线多节点检测工具（check-host.net）验证全球可达性。\n\n说明：详细结果请在管理页查看，本页仅显示完成提示。')) {
    CHECKING = false; return;
  }
  const bad = [];
  let done = 0;
  const CONC = 6;
  async function worker() {
    while (done < targets.length) {
      const i = done++;
      statEl.textContent = `检测中 ${i + 1}/${targets.length}…`;
      const b = targets[i];
      const r = await probe(b.url);
      if (r !== 'ok') { BAD_MAP[b.id] = r; bad.push({ id: b.id, title: b.title, url: b.url, status: r }); }
    }
  }
  const pool = [];
  for (let i = 0; i < Math.min(CONC, targets.length); i++) pool.push(worker());
  await Promise.all(pool);

  await setSettings({ lastCheck: { time: Date.now(), total: targets.length, bad } });
  renderStat();
  render();
  CHECKING = false;

  // 检测完成后引导去管理页查看详细结果
  if (bad.length > 0) {
    if (confirm(`检测完成：${targets.length} 个书签中发现 ${bad.length} 个不可达。\n\n详细结果（「网站故障 / 本地访问不可达」分类标记、勾选重检、批量删除）请在管理页查看。\n\n是否立即打开管理页？`)) {
      chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });
    }
  } else {
    alert(`检测完成：${targets.length} 个书签全部可达。`);
  }
}

/* ---------- 收藏当前页到指定分组 ---------- */
let COLLECT_TAB = null;   // 待收藏的当前标签页
let FOLDERS = [];         // 全部分组 { id, name }

function loadFolders() {
  return new Promise((resolve) => {
    chrome.bookmarks.getTree((tree) => {
      const out = [];
      // 从根节点(id 0)的 children 开始：根节点标题为空，直接拼接会出现「未命名 /」前缀
      (function walk(nodes, path) {
        for (const n of nodes) {
          if (n.url || !n.children) continue;
          const p = path ? path + ' / ' + n.title : n.title;
          if (p) out.push({ id: n.id, name: p });
          walk(n.children, p);
        }
      })((tree[0] && tree[0].children) || [], '');
      resolve(out);
    });
  });
}

function renderGrpList() {
  const q = $('grpSearch').value.trim().toLowerCase();
  const list = FOLDERS.filter((f) => !q || f.name.toLowerCase().includes(q));
  const ul = $('grpList');
  if (list.length === 0) {
    ul.innerHTML = '<li class="empty">无匹配分组</li>';
    return;
  }
  ul.innerHTML = list.map((f) =>
    `<li class="grp-item" data-id="${f.id}" data-name="${escapeHtml(f.name)}"><span class="icon">📁</span>${escapeHtml(f.name)}</li>`
  ).join('');
  ul.querySelectorAll('.grp-item').forEach((el) => {
    el.addEventListener('click', () => saveToFolder(el.getAttribute('data-id'), el.getAttribute('data-name')));
  });
}

function saveToFolder(folderId, folderName) {
  if (!COLLECT_TAB) return;
  const title = $('collectTitle').value.trim() || COLLECT_TAB.url;
  chrome.bookmarks.create({
    parentId: folderId,
    title: title,
    url: COLLECT_TAB.url
  }, () => {
    closeCollect();
    statEl.textContent = `已收藏到「${folderName}」`;
    loadBookmarks().then((l) => { ALL = l; renderStat(); render(); });
  });
}

// Chrome 原生可收藏的地址协议（书签可正常保存与打开）
const BOOKMARKABLE_RE = /^(https?|file|ftp|chrome|chrome-extension|view-source):/i;

function openCollect() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const t = tabs && tabs[0];
    if (!t || !BOOKMARKABLE_RE.test(t.url || '') || /^about:blank/i.test(t.url || '')) {
      alert('当前页签没有可收藏的地址（空白页或浏览器内部页不可收藏）');
      return;
    }
    COLLECT_TAB = { title: t.title, url: t.url };
    $('collectInfo').textContent = t.url;
    $('collectTitle').value = t.title || t.url;
    loadFolders().then((fs) => {
      FOLDERS = fs;
      $('grpSearch').value = '';
      renderGrpList();
      $('collectPanel').classList.remove('hidden');
      $('grpSearch').focus();
    });
  });
}

function closeCollect() {
  $('collectPanel').classList.add('hidden');
  COLLECT_TAB = null;
}

/* ---------- 导出面板：与管理页一致的选项（全部 / 自定义勾选） ---------- */
let ROOTS = [];   // 书签树顶层（书签栏/其他书签的 children）

function loadRoots() {
  return new Promise((resolve) => {
    chrome.bookmarks.getTree((tree) => {
      ROOTS = (tree[0] && tree[0].children) || [];
      resolve(ROOTS);
    });
  });
}

function openExportPanel() {
  loadRoots().then((roots) => {
    $('pexpTree').innerHTML = renderExportTreeHtml(roots);
    bindExportChecks($('pexpTree'));
    document.querySelector('input[name="pexpMode"][value="all"]').checked = true;
    $('pexpTree').classList.add('hidden');
    $('pexpTip').classList.add('hidden');
    $('exportPanel').classList.remove('hidden');
  });
}

function doPopupExport() {
  const mode = document.querySelector('input[name="pexpMode"]:checked').value;
  if (mode === 'all') {
    exportHtml(ALL);
  } else {
    const checked = new Set(Array.from($('pexpTree').querySelectorAll('.exp-ck:checked'))
      .map((el) => el.getAttribute('data-id')));
    if (!exportFromChecked(ROOTS, checked)) return;
  }
  $('exportPanel').classList.add('hidden');
}

/* ---------- 首次使用引导：提示范围胶囊可点击 ---------- */
function dismissTip() {
  $('tip').classList.add('hidden');
  $('tipClose').classList.add('hidden');
  $('scopes').classList.remove('pulse');
  setSettings({ scopeTipShown: true });
}

function init() {
  getSettings().then((s) => {
    if (!s.scopeTipShown) {
      $('tip').classList.remove('hidden');
      $('tipClose').classList.remove('hidden');
      $('scopes').classList.add('pulse');
    }
  });
  loadBookmarks().then((list) => {
    ALL = list;
    getSettings().then((s) => {
      if (s.lastCheck && s.lastCheck.bad) {
        s.lastCheck.bad.forEach((b) => { BAD_MAP[b.id] = b.status || 'bad'; });
      }
      renderStat();
      render();
    });
  });

  qEl.addEventListener('input', render);
  ['scTitle', 'scUrl', 'scGrp'].forEach((id) => $(id).addEventListener('change', render));
  $('tipClose').addEventListener('click', dismissTip);
  ['scTitle', 'scUrl', 'scGrp'].forEach((id) => $(id).addEventListener('change', dismissTip));

  $('openManager').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });
  });
  $('help').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('help.html') });
  });
  $('check').addEventListener('click', checkValidity);
  $('import').addEventListener('click', () => {
    pickAndImport((n) => {
      if (n) {
        statEl.textContent = `已导入 ${n} 个书签`;
        loadBookmarks().then((l) => { ALL = l; renderStat(); render(); });
      }
    });
  });
  $('export').addEventListener('click', openExportPanel);
  $('pexpCancel').addEventListener('click', () => $('exportPanel').classList.add('hidden'));
  $('pexpDo').addEventListener('click', doPopupExport);
  $('exportPanel').addEventListener('click', (e) => { if (e.target === $('exportPanel')) $('exportPanel').classList.add('hidden'); });
  document.querySelectorAll('input[name="pexpMode"]').forEach((r) => {
    r.addEventListener('change', () => {
      const show = r.value === 'custom' && r.checked;
      $('pexpTree').classList.toggle('hidden', !show);
      $('pexpTip').classList.toggle('hidden', !show);
    });
  });
  $('collect').addEventListener('click', openCollect);
  $('collectCancel').addEventListener('click', closeCollect);
  $('grpSearch').addEventListener('input', renderGrpList);
}

document.addEventListener('DOMContentLoaded', init);
