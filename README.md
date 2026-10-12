<div align="center">

# 🔖 Sablewisp

**轻量、现代的 Chrome 书签管理扩展（Manifest V3）**

一键检测失效链接 · 快速搜索 · 分组管理 · 灵活排序 · 批量导入导出

[使用说明](USAGE.md) · [检查说明](AUDIT.md) · [下载安装](https://github.com/zhuyifeiRuichuang/Sablewisp/releases/latest)

</div>

---

## 简介

Sablewisp 解决的是「书签越攒越多、失效链接难以发现、查找与管理费劲」的日常痛点。它不追求大而全，只把最常用、最实用的几件事做扎实（项目代号，与功能无直接关联）：

| 你的痛点 | Sablewisp 的做法 |
|---|---|
| 一堆书签点开却是 404 / 连接超时 | 批量检测并列出「不可达清单」，区分**网站故障**与**本地访问不可达** |
| 记不住书签放在哪个文件夹 | 按标题 / 网址 / 分组名实时搜索，可勾选搜索范围 |
| 找不到想整理的书签 | 按文件夹分组折叠展示，支持勾选批量删除、逐条检测 |
| 换电脑 / 备份迁移 | Netscape 标准格式批量导入导出，可精确到「指定分组 / 分组内指定书签」 |

### 功能特性

- **有效性检测（本地 + 在线双重）** — 本地四重探测优先；本地打不开时改用在线多节点检测（check-host.net）验证全球可达性，规避本地网络误判；支持对单个网址单独检测
- **搜索** — 标题 / 网址 / 分组名实时过滤，顶部三个范围胶囊可分别勾选
- **分组管理** — 按文件夹折叠展示，支持打开全部、删除分组；收藏当前页到指定分组（可改标题、可搜索分组，支持 Chrome 全部可收藏协议）
- **排序** — 添加时间（新→旧 / 旧→新）、网址 A→Z、标题 A→Z
- **批量导入 / 导出** — Netscape 标准 HTML；导出可选「全部」或「自定义」（目录树默认折叠，勾分组即整组、展开后可只勾部分书签）
- **删除管理** — 单条编辑 / 删除、主列表勾选批量删除（选择栏吸顶悬浮）、不可达清单勾选批量删除、分组一键删除
- **浏览辅助** — 右下角快速回到顶部 / 跳到底部；书签增删改自动同步，无需手动刷新

---

## 安装方法

> 本项目**未上架 Chrome 应用商店**（未注册 Chrome 开发者账号），请按以下方式本地加载使用。

**1. 下载源码压缩包**

- GitHub Releases：[下载最新版本](https://github.com/zhuyifeiRuichuang/Sablewisp/releases/latest) → 选择 `Source code (zip)`
- 或 CNB Releases：`https://cnb.cool/zhuzhupower/Sablewisp/-/releases`

**2. 解压到本地目录**

解压到**固定目录**（如 `D:\Tools\Sablewisp`）。该目录会被 Chrome 持续读取，之后请勿删除或移动。

**3. 在 Chrome 中加载**

1. 地址栏打开 `chrome://extensions`
2. 右上角开启 **「开发者模式」**
3. 点击 **「加载已解压的扩展程序」**
4. 选择解压后**含 `manifest.json` 的那一层目录**
5. 点击工具栏拼图图标，将 Sablewisp **固定**到工具栏，即可一键打开

**更新版本**：下载新版本压缩包 → 解压覆盖同一目录 → 回到 `chrome://extensions` 点击扩展卡片上的 **刷新** 图标。

---

## 使用方法

完整使用说明见 👉 **[USAGE.md](USAGE.md)**（弹窗、管理页、检测、导入导出、删除与常见问题逐项说明）。

扩展内也可随时点击右上角 **「帮助」** 按钮打开同样的功能说明。

---

## 参与开发

本项目同时在两个平台维护，两者的协作方式**不同**：

| 平台 | 仓库 | 定位 | 协作方式 |
|---|---|---|---|
| GitHub | `zhuyifeiRuichuang/Sablewisp` | 公开镜像 | **不接受社区 PR**，如需定制请 fork 后自行维护 |
| 腾讯 CNB | `zhuzhupower/Sablewisp` | 主开发仓库 | **更新须提交 PR 并合并**（不接受直接推送 main） |

### GitHub：fork 自行维护

```bash
git clone https://github.com/zhuyifeiRuichuang/Sablewisp.git
cd Sablewisp
# 修改后按「安装方法」加载本地目录即可实时调试：
# chrome://extensions → 点击扩展卡片上的刷新图标
```

### CNB：分支 → PR → 合并

```bash
git clone https://cnb.cool/zhuzhupower/Sablewisp.git
cd Sablewisp
git checkout -b feat/your-change      # 1. 从 main 切分支
git commit -am "说明改动"              # 2. 提交改动
git push origin feat/your-change      # 3. 推送分支
# 4. 在 CNB 仓库页面创建 Pull Request → 合并到 main
# 5. 基于 main 发布 Release
```

### 源码结构

| 文件 | 作用 |
|---|---|
| `manifest.json` | 扩展清单（bookmarks / storage / tabs 权限 + host_permissions + CSP） |
| `popup.html / .js / .css` | 工具栏弹窗：搜索、收藏当前页、导入导出、检测、帮助 |
| `manager.html / .js / .css` | 完整管理页：分组 / 排序 / 检测 / 不可达清单 / 选择性导出 |
| `common.js` | 共用逻辑：书签读取、排序、本地 + 在线混合探测、导入导出 |
| `background.js` | Service Worker：设置初始化 + 在线可达性检测消息中枢 |
| `help.html` | 扩展内置功能说明页 |
| `check_dom.mjs` | 开发自检脚本（DOM 引用完整性校验） |

MIT 许可下可自由使用、修改、分发，fork 后请保留原始许可声明。

---

## License

[MIT](LICENSE) © zhuyifeiRuichuang
