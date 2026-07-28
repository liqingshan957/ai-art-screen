# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**敦煌AIGC艺术展 · 投屏展示系统** — 广州美术馆展览现场的运营工具。孩子在现场用 AI 创作作品，系统自动抠图、实时投屏展示，家长扫码在手机上查看作品页（含课程推广转化）。

**双数据源架构**：本地手动上传作品 + CMS 远程相册（通过 OpenAPI 拉取），两者合并展示。

## Commands

```bash
# 启动主服务（必需：Node.js + Express + Socket.IO）
npm start          # node server.js (port 3000)

# 本地开发（含自动抠图，需要 Rembg 服务）
ENABLE_AUTO_CUTOUT=true node server.js     # 默认，开启自动抠图

# 纯服务模式（不抠图，等远程 notify 推送大屏）
ENABLE_AUTO_CUTOUT=false node server.js    # 服务器部署用

# 启动 Rembg 抠图服务（Python，自动抠图需要）
start-rembg.bat    # Python 服务，端口 7000，模型 u2net

# 本地抠图工作脚本（配合远程服务器，独立运行）
node scripts/local-cutout-worker.js

# 安装依赖
npm install        # express, socket.io, multer, sharp
```

## Architecture

```
收件箱监听/飞书同步 → POST /api/auto-matting → Node 主服务
  → ① Sharp 裁剪原图（102×152mm 设计卡去边距）
  → ② HTTP POST → Rembg 抠图（port 7000）
  → ③ 保存抠图版到 uploads/artworks/
  → ④ 写入 data/artworks.json
  → ⑤ 生成手机分享页到 web-gallery/works/{id}.html（纯静态，含OG标签+分析信标）
  → ⑥ 生成 web-gallery/data/works-data.json（画廊页数据快照，离线降级用）
  → ⑦ Socket.IO -> 大屏 display.html 触发特写动画
```

两种上传路径：
- **自动抠图**（`POST /api/auto-matting`）：收件箱/飞书调用，经历完整抠图流水线
- **手动上传**（`POST /api/artworks/upload` 或 `/api/artworks/batch`）：管理员操作，不抠图不裁剪

### 抠图模式（双模式）

```
ENABLE_AUTO_CUTOUT=true（本地开发，默认）
  CMS 新作品 → 服务端轮询 → 自动抠图队列 → Rembg → 上传 CMS → push 大屏

ENABLE_AUTO_CUTOUT=false（服务器部署）
  CMS 新作品 → 服务端轮询（仅同步缓存，不入队列）
  ↓
  本地电脑 local-cutout-worker.js
    → 轮询 CMS → 下载 → Rembg → 上传 → POST /api/cms/cutout/notify
    → 服务器收到通知 → push 大屏
```

### 双数据源 & CMS 集成

```
CMS 远程相册 (OpenAPI)         本地文件 (artworks.json)
       │                              │
       │ 定时同步 / 手动触发             │
       ▼                              ▼
   getAllArtworks() 合并去重（CMS 优先）
       │
       ├── display.html (大屏)
       ├── web-gallery/index.html (画廊 SPA)
       ├── web-admin/admin.html (后台管理)
       └── works-data.json (静态快照)
```

- CMS 作品以 `cms_{mediaId}` 为 ID，本地作品以 uuid 为 ID
- `data/cms-cache.json`：远程相册的本地缓存
- `data/cms-config.json`：API Key（XOR 混淆存储，运行时解混淆）
- 管理后台可设置"展示相册"，只显示该相册作品

### 画廊 SPA 三层加载策略（web-gallery/index.html）

| 优先级 | 数据源 | 条件 |
|--------|--------|------|
| 1. CMS 直连 | `<meta name="cms-api-key">` 在线拉取 | 有后端 API |
| 2. 静态快照 | `data/works-data.json` | 无后端，纯静态托管 |
| 3. 离线兜底 | 显示"暂无作品" | 以上均不可用 |

`work.html` 是手机分享页模板，服务端渲染时填入具体作品数据，输出静态 HTML 到 `works/{id}.html`。

### 目录结构

```
ai-art-screen/
├── server.js               # 唯一后端入口（~950行）。API + Socket.IO + 抠图流水线 + CMS 代理
├── web-gallery/             # 🖼️ 作品画廊（纯前端 SPA，可独立部署到任何静态托管）
│   ├── index.html          #     画廊首页（三层加载：CMS 直连→静态快照→离线）
│   ├── work.html           #     作品详情页模板（预生成时服务端渲染填充）
│   ├── works/              #     预生成手机作品页（含 OG 标签+分析信标，gitignored）
│   └── data/               #     作品列表快照（由抠图流水线生成）
│       └── works-data.json
├── web-admin/               # 后台管理 + 大屏前端（Express 直接 serve）
│   ├── admin.html          #     后台管理（上传/相册/CMS 配置/抠图队列）
│   ├── display.html        #     大屏展示（浮动卡片+粒子特效+视频插播）
│   ├── dashboard.html      #     运营数据看板
│   ├── js/
│   │   ├── api.js          #     前端 API 封装层（fetch 封装）
│   │   ├── admin.js        #     管理后台逻辑 v3
│   │   └── display.js      #     大屏展示引擎 v4（浮动气泡+spotlight+视频排队）
│   └── css/
│       └── admin.css       #     管理后台样式
├── services/rembg/         # Python 独立抠图服务（基于 rembg + http.server）
│   └── rembg-server.py     #     零外部依赖，POST /api/remove 接收图片返回 PNG
├── scripts/                # 工具脚本
│   ├── init-album-data.js  #     初始化活动相册数据
│   ├── local-cutout-worker.js          #     本地 Rembg 抠图工作脚本（配合远程服务器）
│   └── local-cutout-config.template.json  #     抠图工作脚本配置模板
├── examples/               # 示例作品图片
├── data/                   # 后端运行时 JSON 数据文件（artworks.json, analytics.json 等）
├── docs/
│   ├── openapi.md          #     OpenAPI 接口文档（第三方系统集成用）
│   └── deploy/             #     部署文档、SSH 密钥、证书管理
└── uploads/                # 用户上传的图片/视频（gitignored）
    ├── artworks/           #     抠图版（透明背景 PNG）
    ├── originals/          #     原图 + 裁剪版
    ├── background/         #     背景图
    └── videos/             #     插播视频
```

### 关键依赖

| package | 用途 |
|---------|------|
| express | HTTP 服务 / API 路由 / 静态文件 |
| socket.io | WebSocket 实时推送（新作品→大屏即时显示） |
| multer | 文件上传（图片/视频） |
| sharp | 图片裁剪、格式转换、缩略图生成 |

### 三个独立进程

| 进程 | 端口 | 启动 | 功能 |
|------|------|------|------|
| Node 主服务 | 3000 | `node server.js` | API + 页面 + Socket.IO + CMS 代理 |
| Rembg 抠图 | 7000 | `start-rembg.bat` | Python AI 背景移除（u2net/u2net_human） |
| 收件箱监听 | - | 独立项目 | 轮询 B/C 电脑收件箱（172.16.29.64:8765） |

### 核心数据文件（data/）

| 文件 | 用途 | 说明 |
|------|------|------|
| `artworks.json` | 本地作品数据 | 数组，每项含 id/name/url/date/status |
| `artworks_archive.json` | 归档作品 | 下架的作品移到此处 |
| `background.json` | 背景图配置 | filename, position, scale |
| `videos.json` | 视频列表 | 插播视频 URL |
| `videos_config.json` | 视频播放配置 | interval(秒), repeat(次数) |
| `analytics.json` | 访问统计 | 按日期统计 PV/访客 |
| `dashboard.json` | 运营看板 | 手动填写的运营数据 |
| `cms-config.json` | CMS 配置 | API Key(XOR 混淆), API Base |
| `cms-cache.json` | CMS 缓存 | 拉取的远程相册数据（gitignored） |
| `cutout-queue.json` | 抠图队列 | 异步抠图任务（gitignored） |

### 裁剪规格

设计卡 102mm×152mm，裁剪参数按物理比例：
- 左/右各 8/102（7.84%）
- 上 8/152（5.26%），下 32/152（21.05%）
- 可见区域：86mm × 112mm

### 大屏展示引擎（web-admin/js/display.js）

- 6 张浮动卡片始终在屏幕，10-20 秒轮换
- Canvas 粒子背景系统（星点+飘浮粒子）
- 新作品触发 Spotlight 特写：粒子爆发→原图展示(5.5s)→缩小→闪光变抠图→归位卡片
- 视频插播定时器：播放期间新作品排队，结束后依次处理
- 前端 canvas 二次去白边（`cropWhiteBorders`）
- 可配置常量：FIXED_CARDS, MIN/MAX_LIFETIME, originalDuration

### 静态部署说明

`web-gallery/` 目录是纯前端 SPA，可独立部署到任何静态托管（CDN / OSS / PageFire / GitHub Pages）：
- 上传 `web-gallery/` 目录即可
- 需要 `data/works-data.json` 作为数据源（由后端抠图流水线自动生成）
- 可选：在 HTML 中嵌入 `<meta name="cms-api-key">` 以启用 CMS 直连模式

## Socket.IO 事件

| 事件 | 方向 | 触发时机 |
|------|------|----------|
| `sync` | 服务→客户端 | 新客户端连接（全量同步：作品/背景/视频） |
| `artwork:new` | 服务→大屏 | 新作品到达→触发特写 |
| `artwork:archive` | 服务→大屏 | 作品下架 |
| `artwork:restore` | 服务→大屏 | 作品恢复 |
| `artwork:purge` | 服务→大屏 | 作品彻底删除 |
| `background:update` | 服务→大屏 | 背景图更换 |
| `videos:update` | 服务→大屏 | 视频列表变更 |
| `videos:config` | 服务→大屏 | 视频配置变更 |
| `display:connected` | 大屏→服务 | 大屏页面就绪（触发计数） |
| `display:reload` | 服务→大屏 | 展示相册切换→强制刷新 |

## API 路由一览（server.js）

| 路由 | 功能 |
|------|------|
| `GET /display`, `/admin`, `/dashboard` | HTML 页面 |
| `GET /gallery` | 作品画廊 SPA |
| `GET /gallery/works/{id}.html` | 预生成手机分享页 |
| `GET /gallery/data/works-data.json` | 作品列表快照 |
| `GET /` → redirect `/gallery` | 根路径重定向 |
| `GET /work/:id` → 301 redirect | 短链跳转分享页 |
| `GET/POST /api/artworks*` | 作品 CRUD、统计、批量上传 |
| `POST /api/auto-matting` | 自动抠图流水线（核心） |
| `GET/POST /api/artworks/cutout-queue*` | 异步抠图队列管理 |
| `GET/POST/PUT /api/background` | 背景图管理 |
| `GET/POST/PUT/DELETE /api/videos*` | 视频管理 |
| `GET /api/analytics/today` | 访问统计 |
| `GET /api/analytics/beacon` | 1x1 GIF 分析信标 |
| `GET/POST /api/dashboard/today` | 运营看板 |
| `GET/PUT /api/cms/display-album` | 展示相册设置 |
| `POST /api/cms/albums/sync` | 手动触发 CMS 相册同步 |
| `POST /api/cms/cutout/notify` | 本地 Rembg 抠图完成通知（推送大屏） |
| `POST /api/cms/cutout/scan/:albumId` | 扫描相册中缺少抠图的媒体 |
| `POST /api/cms/cutout/:albumId/:mediaId` | 手动触发单张抠图 |
| `GET/DELETE /api/cms/cutout/queue` | 抠图队列状态查询/清理 |
| `GET /open-api/v1/*` | OpenAPI 第三方接口（代理至 `vapi.hkting.com`） |
