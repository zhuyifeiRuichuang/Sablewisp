// 静态功能自检：校验 JS 中引用的 DOM id / 元素是否都在对应 HTML 中真实存在
import fs from 'fs';

const pairs = [['popup.js', 'popup.html'], ['manager.js', 'manager.html']];
let fail = 0;

for (const [jsFile, htmlFile] of pairs) {
  const js = fs.readFileSync(jsFile, 'utf8');
  const html = fs.readFileSync(htmlFile, 'utf8');

  // $('xxx') / getElementById('xxx')
  const ids = new Set();
  for (const m of js.matchAll(/\$\(\s*'([^']+)'\s*\)/g)) ids.add(m[1]);
  for (const m of js.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) ids.add(m[1]);

  const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

  const missing = [...ids].filter((id) => !htmlIds.has(id));
  console.log(`[${jsFile}] 引用 id ${ids.size} 个，HTML 定义 ${htmlIds.size} 个`);
  if (missing.length) { console.log(`  ❌ 缺失: ${missing.join(', ')}`); fail++; }
  else console.log('  ✅ 全部存在');

  // 未被引用的 HTML id（仅提示，不算失败）
  const unused = [...htmlIds].filter((id) => !ids.has(id));
  if (unused.length) console.log(`  ℹ️ HTML 中未被 JS 直接引用: ${unused.join(', ')}`);
}

// 检查跨文件调用的函数是否都在 common.js 中定义
const common = fs.readFileSync('common.js', 'utf8');
const commonFn = new Set([...common.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(/g)].map((m) => m[1]));
for (const f of ['popup.js', 'manager.js']) {
  const src = fs.readFileSync(f, 'utf8');
  const localFn = new Set([...src.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(/g)].map((m) => m[1]));
  const called = [...src.matchAll(/\b([a-z][A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]);
  const builtin = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'alert', 'confirm', 'parseInt', 'parseFloat', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Set', 'Map', 'Promise', 'Date', 'Math', 'JSON', 'isNaN', 'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'await', 'new']);
  const unknown = [...new Set(called)].filter((n) => !builtin.has(n) && !localFn.has(n) && !commonFn.has(n));
  console.log(`[${f}] 可能未定义的调用（需人工确认是否来自 chrome API/对象方法）: ${unknown.length ? unknown.join(', ') : '无'}`);
}

console.log(fail === 0 ? '\n✅ DOM 引用自检通过' : `\n❌ 有 ${fail} 处缺失`);
process.exit(fail === 0 ? 0 : 1);
