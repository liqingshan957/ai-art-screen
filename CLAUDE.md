# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**敦煌AIGC艺术展 · 投屏展示系统** — 广州美术馆展览现场的运营工具。孩子在现场用 AI 创作作品，系统自动抠图、实时投屏展示，家长扫码在手机上查看作品页（含课程推广转化）。

## Commands

```bash
# 启动主服务（必需：Node.js + Express + Socket.IO）
npm start          # node server.js
npm run dev        # node server.js

# 依赖安装
npm install        # express, socket.io, multer, sharp, form-data

# 启动 Rembg 抠图服务（可选，自动抠图需要）
scripts/start-rembg.bat    # Python 服务，端口 7000

# 一键启动全部（主服务 + 抠图 + 收件箱监听）
scripts/启动投屏系统.bat
```

## Architecture

### 目录结构

```
ai-art-screen/
├── server.js               # 唯一后端入口。API + Socket.IO + 抠图流水线
├── web/                    # 前端页面（静态文件，Express 直接 serve）
│   ├── admin.html          # 后台管理（上传/归档/配置）
│   ├── display.html        # 大屏展示（浮动卡片+粒子特效+视频插播）
│   ├── gallery.html        # 作品画廊（纯前端，支持 API/静态双数据源）
│   ├── dashboard.html      # 运营数据看板
│   └── data/               # 前端静态数据快照（gitignored，运行时生成）
├── templates/              # 手机分享页 HTML 模板（{{PLACEHOLDER}} 渲染）
├── services/rembg/         # Python 独立抠图服务
├── scripts/                # Windows 启动脚本
├── data/                   # 运行时 JSON 数据文件（动态生成）
├── uploads/                # 用户上传的图片/视频（gitignored）
└── deploy/pagefire/        # PageFire 公网部署产物（gitignored）
```

### 关键依赖

| package | 用途 |
|---------|------|
| express | HTTP 服务 / API 路由 |
| socket.io | WebSocket 实时推送（新作品→大屏即时显示） |
| multer | 文件上传（图片/视频） |
| sharp | 图片裁剪、格式转换 |
| form-data | CDN 上传 multipart 构造 |

### 三个独立进程

| 进程 | 端口 | 启动 | 功能 |
|------|------|------|------|
| Node 主服务 | 3000 | `node server.js` | API + 页面 + Socket.IO |
| Rembg 抠图 | 7000 | `scripts/start-rembg.bat` | Python AI 背景移除 |
| 收件箱监听 | - | 独立项目 | 轮询 B/C 电脑收件箱 |

### 核心数据流

```
收件箱监听/飞书同步 → POST /api/auto-matting → Node 主服务
  → ① Sharp 裁剪原图（102×152mm 设计卡去边距）
  → ② HTTP POST → Rembg 抠图（port 7000）
  → ③ 保存抠图版到 uploads/artworks/
  → ④ 写入 data/artworks.json
  → ⑤ 生成手机分享页到 web/works/{id}.html（纯静态，含OG标签+分析信标）
  → ⑥ 生成 web/data/works-data.json（画廊页数据快照）
  → ⑦ 上传图片到 CDN（img.hkting.com）
  → ⑧ Socket.IO -> 大屏 display.html 触发特写动画
  → ⑨ 15s 后 PageFire 公网部署
```

两种上传路径：
- **自动抠图**（`/api/auto-matting`）：收件箱/飞书调用，经历完整①②③…流程
- **手动上传**（`/api/artworks/upload` 或 `/batch`）：管理员操作，不抠图不裁剪

### API 接口一览

| 路由 | 功能 |
|------|------|
| `GET /display` `GET /admin` `GET /dashboard` `GET /gallery` | HTML 页面 |
| `GET /` | 重定向到 `/gallery` |
| `GET /work/:id` | 301 重定向到作品静态页 `/works/{id}.html` |
| `GET /works/{id}.html` | 预生成的手机作品分享页（纯静态） |
| `GET/POST /api/artworks*` | 作品 CRUD、统计、批量 |
| `POST /api/auto-matting` | 自动抠图流水线（核心） |
| `GET/POST/PUT /api/background` | 背景图管理 |
| `GET/POST/PUT/DELETE /api/videos*` | 视频管理 |
| `GET /api/analytics/today` | 访问统计 |
| `GET /api/analytics/beacon` | 1x1 GIF 分析信标（静态页用） |
| `GET/POST /api/dashboard/today` | 运营看板数据 |

### Socket.IO 事件

| 事件 | 方向 | 触发时机 |
|------|------|----------|
| `sync` | 服务→客户端 | 新客户端连接（全量同步） |
| `artwork:new` | 服务→大屏 | 新作品到达→触发特写 |
| `artwork:archive/restore/purge` | 服务→大屏 | 作品状态变更 |
| `background:update` | 服务→大屏 | 背景图更换 |
| `videos:update/config` | 服务→大屏 | 视频列表/配置变更 |
| `display:connected` | 大屏→服务 | 大屏页面就绪（触发计数） |

### 大屏展示引擎（display.js）

- 6 张浮动卡片始终在屏幕，10-20 秒轮换
- 新作品触发 Spotlight 特写：粒子爆发→原图展示(5.5s)→缩小→闪光变抠图→归位卡片
- 视频插播定时器：播放期间新作品排队，结束后依次处理
- 前端 canvas 二次去白边（`cropWhiteBorders`）

### 裁剪规格

设计卡 102mm×152mm，裁剪参数按物理比例：
- 左/右各 8/102（7.84%）
- 上 8/152（5.26%），下 32/152（21.05%）
- 可见区域：86mm × 112mm
