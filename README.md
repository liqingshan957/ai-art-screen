# 敦煌 AIGC 艺术展 · 投屏展示系统

广州美术馆展览现场的运营工具。现场孩子用 AI 创作作品，系统自动抠图、实时投屏展示，家长扫码即可在手机上查看作品。

---

## 系统架构

```
┌─ 双数据源 ────────────────────────────────────────┐
│                                                    │
│  CMS 远程相册 (OpenAPI)         本地 artworks.json  │
│       │                              │             │
│  ┌────▼─────┐                 ┌──────▼──────┐      │
│  │ 5s 增量  │                 │ 手动上传     │      │
│  │ 5min全量 │                 │ POST /upload │      │
│  └────┬─────┘                 └──────┬───────┘      │
│       │                              │              │
│       ▼        getAllArtworks()      ▼              │
│   ┌─────────────────────────────────────┐           │
│   │    合并去重（CMS 优先）               │           │
│   └──────────┬──────────────────────────┘           │
│              │                                      │
└──────────────┼──────────────────────────────────────┘
               │
               ▼
┌─ Node.js 主服务 (port 3000) ────────────────────┐
│                                                   │
│  [收件箱流水线] POST /api/auto-matting             │
│    ① Sharp 裁剪(102×152mm)  ② Rembg 抠图         │
│    ③ 保存作品  ④ 生成分享页  ⑤ Socket.IO 推大屏   │
│                                                   │
│  [CMS 同步] 5s 增量轮询 + 5min 全量兜底            │
│    自动合并到本地缓存 → 推送给大屏 / 画廊           │
│                                                   │
│  [抠图队列] ENABLE_AUTO_CUTOUT=true 时            │
│    自动抠 CMS 新作品 → 上传 → 通知                 │
│                                                   │
│  API: 作品/背景/视频/统计/看板/CMS管理             │
└──────┬──────────────────────────────┬─────────────┘
       │ Socket.IO                    │ HTTP
       ▼                              ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ 🖥️ 大屏展示  │  │ ⚙️ 后台管理  │  │ 📱 手机画廊  │
│ display.html │  │ admin.html   │  │ index.html   │
│ 浮动卡片+特效 │  │ 上传/归档/   │  │ SPA 三层加载 │
│ 新作品Spotlight│  │ CMS配置/抠图 │  │ CMS→快照→离线│
└──────────────┘  └──────────────┘  └──────────────┘
```

## 核心地址

| 用途 | 地址 |
|------|------|
| 后台管理 | `http://localhost:3000/admin` |
| 大屏展示 | `http://localhost:3000/display` |
| 数据看板 | `http://localhost:3000/dashboard` |
| 手机作品页 | `http://localhost:3000/gallery/works/{作品ID}.html` |

## 快速启动

### 安装依赖

```bash
npm install
```

### 启动方式

| 场景 | 命令 |
|------|------|
| 🎪 **展览现场**（不抠图，等远程通知） | `启动投屏系统（不抠图）.bat` |
| 💻 **本地开发**（自动抠图） | `启动本地投屏系统（自动抠图）.bat` |
| 🔧 **抠图员电脑**（Rembg + Worker） | `启动CMS自动抠图.bat` |
| 🧩 **仅 Rembg 服务** | `启动Rembg抠图服务.bat` |
| ⚡ 手动启动主服务 | `node server.js` |

浏览器打开 `http://localhost:3000/admin` 进入后台管理。

> **注意：** Rembg 需要 Python 环境，首次启动会自动下载 u2net 模型（约 200MB）。

---

## 目录结构

```
ai-art-screen/
├── server.js                  # 🎯 唯一后端入口。API + Socket.IO + 抠图流水线 + CMS 代理
├── web-admin/                 # 后台管理 + 大屏前端（Express 直接 serve）
│   ├── admin.html             #     后台管理（上传/相册/CMS 配置/抠图队列）
│   ├── display.html           #     大屏展示（浮动卡片+粒子特效+视频插播）
│   ├── dashboard.html         #     运营数据看板
│   ├── js/
│   │   ├── api.js             #     前端 API 封装
│   │   ├── admin.js           #     管理后台逻辑
│   │   └── display.js         #     大屏展示引擎（浮动气泡+spotlight+视频排队）
│   └── css/
│       └── admin.css
├── web-gallery/               # 🖼️ 作品画廊 SPA（可独立部署到静态托管）
│   ├── index.html             #     画廊首页（三层加载：CMS直连→快照→离线）
│   ├── work.html              #     作品详情页模板（SSR 填充）
│   └── data/works-data.json   #     作品列表快照（抠图流水线自动生成）
├── services/rembg/            # Python 独立抠图服务
│   └── rembg-server.py        #     零外部依赖，POST /api/remove 返回 PNG
├── scripts/                   # 工具脚本
│   ├── local-cutout-worker.js #     本地 Rembg 抠图工作脚本
│   ├── local-cutout-config.template.json  # Worker 配置模板
│   └── setup-config.js        #     CMS 自动抠图交互式配置向导
├── data/                      # 后端运行时 JSON 数据文件
│   ├── artworks.json          #     本地作品数据
│   ├── artworks_archive.json  #     归档作品
│   ├── background.json        #     背景图配置
│   ├── videos.json            #     插播视频列表
│   ├── videos_config.json     #     视频播放配置
│   ├── analytics.json         #     访问统计
│   ├── dashboard.json         #     运营看板
│   ├── cms-config.json        #     CMS API 配置（XOR 混淆）
│   ├── cms-cache.json         #     CMS 远程相册缓存（gitignored）
│   └── cutout-queue.json      #     抠图队列（gitignored）
├── docs/
│   ├── openapi.md             #     OpenAPI 接口文档
│   ├── timers-and-listeners.md #     所有定时任务 & 监听器清单
│   └── deploy/                #     部署文档、SSH 密钥、证书管理
├── uploads/                   # 用户文件（gitignored）
│   ├── artworks/              #     抠图版（透明背景 PNG）
│   ├── originals/             #     原图 + 裁剪版
│   ├── background/            #     背景图
│   └── videos/                #     插播视频
├── 启动投屏系统（不抠图）.bat     # 🎪 展览现场：清端口+Rembg+主服务+验证
├── 启动本地投屏系统（自动抠图）.bat # 💻 本地开发：Rembg+自动抠图主服务
├── 启动CMS自动抠图.bat          # 🔧 抠图员：Rembg+Worker 轮询 CMS
├── 启动Rembg抠图服务.bat        # 🧩 仅 Python Rembg 抠图服务
├── package.json
└── .gitignore
```

---

## 功能模块

### 1. 自动抠图流水线

两条路径：

**路径 A：收件箱上传**（`POST /api/auto-matting`）
```
原图 → Sharp 裁剪(102×152mm去边距) → Rembg 抠图
     → 保存作品数据 → 生成分享页 → Socket.IO 推大屏
```

**路径 B：CMS 远程相册**（双模式）
```
ENABLE_AUTO_CUTOUT=true（本地开发）
  CMS 新作品 → 5s 增量轮询 → 自动抠图队列 → Rembg → 上传 CMS → push 大屏

ENABLE_AUTO_CUTOUT=false（服务器部署）
  CMS 新作品 → 5s 增量轮询（仅同步缓存）
  ↓
  本地抠图机 (local-cutout-worker.js)
    → 轮询 CMS → 下载 → Rembg → 上传 → POST /api/cms/cutout/notify
    → 服务器收到通知 → push 大屏
```

### 2. 大屏展示

| 效果 | 说明 |
|------|------|
| 浮动画廊 | 6 张卡片随机漂移，10-20 秒轮换 |
| 特写特效 | 新作品入场：粒子爆发 → 原图展示 → 缩小 → 闪光变抠图 |
| 视频插播 | 定时全屏播放（间隔/次数可配置） |
| 排队机制 | 视频播放期间新作品进队列，结束后依次呈现 |

### 3. 作品管理

| 操作 | 说明 |
|------|------|
| 单张上传 | 管理员手动上传（不抠图） |
| 批量上传 | 一次性上传多张，逐个填写名字 |
| CMS 相册管理 | 远程相册 CRUD、媒体启禁、展示相册切换 |
| 自动抠图 | 服务端自动抠图 / 远程 Worker 抠图 |
| 下架归档 | 作品隐藏但保留数据 |
| 彻底删除 | 清除作品文件和数据 |

### 4. 手机分享页

每个作品自动生成独立 H5 页面，含：
- 品牌 Header（大象智绘 AI 科创）
- 作品大图（OG 标签支持微信分享）
- 孩子名字 + 日期
- 长按保存 / 复制链接
- 二楼 AI 动画课程推广卡片
- 微信扫码加群引导

### 5. 运营看板

每天手动填写：体验人数、入团人数、加微信数、课程报名数。结合自动统计（PV、访客数、作品增量），追踪展览运营数据。

---

## 配置

### CMS 集成

| 配置 | 位置 | 说明 |
|------|------|------|
| API Key | `data/cms-config.json`（XOR 混淆） | CMS OpenAPI 密钥 |
| API Base | `data/cms-config.json` | `https://vapi.hkting.com/api/open-api/v1` |
| 展示相册 | Admin 后台 → CMS 设置 | 选择要展示的相册，支持切换 |
| Worker 配置 | `scripts/local-cutout-config.json` | 远程抠图机的 API Key / 通知地址 |

### 视频播放

在 Admin 后台调整，或直接编辑 `data/videos_config.json`：

| 参数 | 默认 | 说明 |
|------|------|------|
| interval | 300 | 播放间隔(秒) |
| repeat | 2 | 每次循环次数 |

### 大屏参数（改 web-admin/js/display.js）

| 常量 | 默认 | 说明 |
|------|------|------|
| FIXED_CARDS | 6 | 同时显示的卡片数 |
| MIN_LIFETIME | 10000 | 卡片最短寿命(ms) |
| MAX_LIFETIME | 20000 | 卡片最长寿命(ms) |
| originalDuration | 5500 | 特写展示时长(ms) |

---

## 技术栈

| 技术 | 用途 |
|------|------|
| Node.js + Express | HTTP 服务 / 50+ API 路由 |
| Socket.IO | 实时推送（大屏即时更新） |
| Sharp | 图片裁剪 / 格式转换 |
| Rembg (Python) | AI 背景移除（u2net 模型） |
| Multer | 文件上传 |
| CMS OpenAPI | 远程相册数据源（`vapi.hkting.com`） |

---

## FAQ

| 问题 | 原因 | 解决 |
|------|------|------|
| "Rembg timeout" | Rembg 抠图服务未启动 | 运行 `启动Rembg抠图服务.bat` |
| 大屏没反应 | 端口 3000 未启动 | 检查 `http://localhost:3000`，或运行 `启动投屏系统（不抠图）.bat` |
| 新作品不显示 | 有视频配置在排队 | 等视频播完，或清空视频列表 |
| CMS 作品不同步 | 展示相册未设置 | 进后台 → CMS 设置 → 选择展示相册 |
| 抠图没反应 | Worker 没跑 / Rembg 挂了 | 检查 Worker 日志，重启 `启动Rembg抠图服务.bat` |
| 上传失败 | 服务地址不对 | 确认收件箱监听配置中的主服务地址 |
