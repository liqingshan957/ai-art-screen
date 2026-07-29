# 部署指南

## 部署概览

本系统有三个可部署的组件：

| 组件 | 部署位置 | 是否必需 |
|------|----------|:--------:|
| **Node 主服务** | 服务器 / 展览现场电脑 | ✅ **必需** |
| **web-gallery SPA** | 静态托管（CDN / OSS / PageFire） | ❌ 可选 |
| **Worker 抠图机** | 本地电脑（独立进程） | ❌ 可选 |

---

## 一、Node 主服务部署

### 展览现场（局域网）

```bash
# 方式1：启动脚本（推荐）
启动投屏系统（不抠图）.bat          # 展览模式，等远程通知
启动本地投屏系统（自动抠图）.bat     # 本地调试，自动抠图

# 方式2：手动启动
npm install
node server.js
```

> 展览现场只需一台 Windows 电脑，双击启动脚本即可。大屏浏览器打开 `http://localhost:3000/display`。

### 生产服务器（Linux）

使用 PM2 管理进程，Nginx 反向代理 + SSL。

**详细步骤 + Nginx 配置 + SSL 证书管理 →** [`docs/deploy/README.md`](deploy/README.md)

```bash
# 服务器快速部署
npm install --production
pm2 start server.js --name ai-art-screen
pm2 save
```

**环境变量：**

| 变量 | 生产环境推荐值 | 说明 |
|------|:-------------:|------|
| `ENABLE_AUTO_CUTOUT` | `false` | 服务器不抠图，由远程 Worker 处理 |
| `CMS_POLL_INTERVAL` | `5000` | CMS 轮询间隔（毫秒） |
| `PORT` | `3000` | 服务端口 |

---

## 二、web-gallery SPA（静态部署）

`web-gallery/` 是纯前端 SPA，可独立部署到任何静态托管：

```
web-gallery/
├── index.html            # 画廊首页（SPA 三层加载）
├── work.html             # 作品详情页模板
├── works/                # 预生成作品页（gitignored）
└── data/
    └── works-data.json   # 作品列表快照（需服务端生成）
```

### 数据源策略

画廊页使用三层加载（`index.html`）：

| 优先级 | 数据源 | 条件 |
|--------|--------|------|
| 1. CMS 直连 | `<meta name="cms-api-key">` 在线拉取 | 有后端 API |
| 2. 静态快照 | `data/works-data.json` | 无后端，纯静态托管 |
| 3. 离线兜底 | 显示"暂无作品" | 以上均不可用 |

### 静态托管示例

```bash
# PageFire
启动投屏系统（不抠图）.bat        # 确保主服务运行
# 然后在后台管理 → 部署 上传 web-gallery/

# 阿里云 OSS
ossutil cp -r web-gallery/ oss://<bucket>/

# GitHub Pages
# 推送 web-gallery/ 到 gh-pages 分支
```

> 静态部署时 `works-data.json` 和 `works/*.html` 是快照，需要服务端重新生成。

---

## 三、Worker 抠图机部署

在**独立的本地电脑**上运行，配合生产服务器的 `ENABLE_AUTO_CUTOUT=false` 模式。

### 前置条件

- Python 3.x（已安装 `rembg` 包：`pip install rembg`）
- 配置文件 `scripts/local-cutout-config.json`（从 `local-cutout-config.template.json` 复制填写）

### 启动

```bash
启动CMS自动抠图.bat
```

Worker 会自动：
1. 每 5 秒增量检查 CMS 展示相册
2. 发现待抠图媒体 → 下载 → Rembg 抠图 → 上传结果到 CMS
3. 通知主服务推送到大屏
4. 每 5 分钟全量兜底，补漏遗漏

---

## 四、部署架构图

```
┌─ 生产服务器 ──────────────────────────────────┐
│                                                 │
│  PM2 → node server.js (port 3000)               │
│  Nginx → HTTPS + WebSocket 代理                 │
│  SSL: Let's Encrypt + Certbot 自动续期           │
│                                                 │
│  ENABLE_AUTO_CUTOUT=false                       │
│  CMS 5s 增量轮询 + 5min 全量兜底                 │
│                                                 │
│  数据流:                                         │
│    CMS API ←→ cms-cache.json ←→ getAllArtworks()│
│    → display.html (大屏)                        │
│    → admin.html (后台管理)                       │
│    → web-gallery (手机画廊)                      │
│                                                 │
└─────────────────────────────────────────────────┘
                         ▲ notify
                         │
┌─ 本地抠图机 ───────────────────────────────────┐
│                                                 │
│  Rembg (port 7000) + Worker (local-cutout)       │
│  轮询 CMS → 抠图 → 上传 → POST /notify          │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 相关文档

| 文档 | 内容 |
|------|------|
| [`docs/deploy/README.md`](deploy/README.md) | 服务器详细部署（PM2 / Nginx / SSL） |
| [`docs/deploy/DEPLOY_PRIVATE.md`](deploy/DEPLOY_PRIVATE.md) | 服务器敏感信息（不提交 Git） |
| [`docs/deploy/CERT_AUTO_RENEWAL.md`](deploy/CERT_AUTO_RENEWAL.md) | SSL 证书自动续期 |
| [`docs/timers-and-listeners.md`](timers-and-listeners.md) | 所有定时轮询 & 监听器清单 |
