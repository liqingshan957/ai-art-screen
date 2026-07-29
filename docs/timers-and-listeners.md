# 定时任务 & 监听器清单

> 记录系统中所有定时轮询、事件监听、Socket.IO 通信和 HTTP 路由。
> 更新日期: 2026-07-29

---

## 一、服务端定时轮询 (server.js)

### 1.1 CMS 增量轮询 — 5 秒

```js
// 第 977 行
setInterval(pollCmsNewMedia, CMS_POLL_INTERVAL);  // CMS_POLL_INTERVAL = 5000
```

**作用：** 增量拉取 CMS 展示相册的新媒体，同步到本地缓存。`ENABLE_AUTO_CUTOUT=true` 时还会自动加入抠图队列。

**API 调用：** `GET /open-api/v1/activity-albums/{albumId}/media/check?sinceId={sinceId}&limit=20`

**状态：** `cmsPollState = { albumId, sinceId }` 记录游标，重启后从 0 开始。

| 环境 | auto cutout | 行为 |
|------|:-----------:|------|
| `ENABLE_AUTO_CUTOUT=true` | ✅ | 同步缓存 + 加入抠图队列 |
| `ENABLE_AUTO_CUTOUT=false` | ❌ | 仅同步缓存 |

---

### 1.2 CMS 全量兜底 — 5 分钟

```js
// 第 979 行
setInterval(async () => { ... }, 300000);
```

**作用：** 全量拉取展示相册所有媒体，补漏本地缓存中缺失的 `cutoutUrl`（防止 notify 丢失）。

**API 调用：** `GET /open-api/v1/activity-albums/{albumId}/media?pageSize=200`

**触发日志：** `[Cache] 补漏 cutoutUrl: ...`

---

### 1.3 抠图队列延迟处理 — 动态 2 秒

```js
// 第 602 行，在 resumeCutoutQueue() 中
if (cutoutQueue.find(q => q.status === 'pending')) setTimeout(processCutoutQueue, 2000);
```

**作用：** 服务启动时如有未完成的抠图任务，延迟 2 秒后开始处理。不是固定间隔，队列处理完自动停止。

**并发：** 每次最多处理 3 张（`batch.slice(0, 3)`）。

**Rembg 超时：** 15 秒（`REMBG_TIMEOUT = 15000`，第 17 行）。

**重试策略：** 失败后标记 `status: 'pending'` 重新排队，最多重试 5 次。

---

## 二、Worker 端定时轮询 (local-cutout-worker.js)

### 2.1 CMS 增量轮询 — 5 秒

```js
// 第 300 行
setInterval(mainLoop, POLL_INTERVAL);  // POLL_INTERVAL = 5000
```

**作用：** 增量检查 CMS 展示相册的新媒体，发现没有 `cutoutUrl` 的就下载原图 → Rembg → 上传结果 → 通知服务器。

**API 调用：** `GET /open-api/v1/activity-albums/{albumId}/media/check?sinceId={sinceId}&limit=20`

**状态持久化：** `scripts/temp/poll-state.json`（重启不丢进度）。

**互斥锁：** `isRunning` 防止上一轮还没完成时重复执行。

---

### 2.2 CMS 全量兜底 — 5 分钟

```js
// 第 304 行
setInterval(fullScan, 300000);
```

**作用：** 全量拉取 CMS 相册所有媒体，找出增量轮询遗漏的（无 `cutoutUrl` 但没被增量捡到），去重后补抠。

**API 调用：** `GET /open-api/v1/activity-albums/{albumId}/media?pageSize=200`

**去重：** 使用 `processingIds` Set 防止和增量轮询同时处理同一条媒体。

---

## 三、Socket.IO 事件

### 3.1 服务端 → 客户端 (emit)

| 事件 | 触发时机 | 接收方 |
|------|----------|--------|
| `sync` | 客户端刚连接时全量推送 | 大屏/后台 |
| `artwork:new` | 新作品到达（自动抠图/手动上传/CMS notify） | 大屏 → 触发 Spotlight |
| `artworks:batch` | 批量上传完成 | 大屏/后台 |
| `artwork:archive` | 作品下架 | 大屏/后台 |
| `artwork:restore` | 作品恢复 | 大屏/后台 |
| `artwork:purge` | 作品彻底删除 | 大屏/后台 |
| `artwork:update` | 作品信息更新 | 大屏/后台 |
| `background:update` | 背景图更换 | 大屏 |
| `videos:update` | 视频列表变更 | 大屏/后台 |
| `videos:config` | 视频播放配置变更 | 大屏 |
| `display:reload` | 展示相册切换 → 强制刷新大屏 | 大屏 |

### 3.2 客户端 → 服务端

| 事件 | 发送方 | 作用 |
|------|--------|------|
| `display:connected` | 大屏 | 上报连接，触发 displayViews 统计 |

### 3.3 大屏端监听 (display.js)

| 事件 | 处理 |
|------|------|
| `connect` | 重连后刷新全量数据 |
| `sync` | 初始化作品列表、背景、视频配置 |
| `artwork:new` | 触发 Spotlight 特写动画 |
| `artworks:batch` | 批量添加到卡片池 |
| `artwork:archive` | 从卡片池移除 |
| `artwork:purge` | 从卡片池移除（含缓存清理） |
| `artwork:restore` | 恢复到卡片池 |
| `artwork:update` | 更新卡片 URL |
| `background:update` | 更新背景图 |
| `videos:update` | 更新视频播放列表 |
| `videos:config` | 更新播放间隔/重复次数 |
| `display:reload` | 强制刷新页面 |

### 3.4 后台管理监听 (admin.js)

| 事件 | 处理 |
|------|------|
| `connect` | 刷新作品列表 |
| `disconnect` | 显示断开提示 |
| `sync` | 初始化作品列表、背景、视频配置 |
| `artwork:new` | 刷新 CMS 作品列表 |
| `artworks:batch` | 刷新作品列表 |
| `artwork:archive` | 刷新作品列表 |
| `artwork:restore` | 刷新作品列表 |
| `artwork:purge` | 刷新作品列表 |
| `artwork:update` | 刷新作品列表 |
| `background:update` | 更新背景预览 |
| `videos:update` | 刷新视频列表 |
| `pagefire:deploy-done` | PageFire 部署完成通知 |

---

## 四、前端定时器 (浏览器)

### 4.1 后台管理 (admin.js)

| 间隔 | 作用 |
|:----:|------|
| **30 秒** | CMS 增量轮询：检查展示相册新作品，发现无抠图的自动触发抠图 |
| **30 秒** | Rembg 健康检测 + 抠图队列状态刷新（仅当抠图面板可见时） |
| **30 秒** | Rembg 健康检测（顶部常驻指示灯） |

### 4.2 大屏展示 (display.js)

| 间隔 | 作用 |
|:----:|------|
| **600 毫秒** | Spotlight 特写时浮动粒子效果 |
| **150 毫秒** | Spotlight 特写时尾迹粒子（共 8 次后自动清除） |

---

## 五、HTTP 服务监听

### 5.1 Express 中间件

| 中间件 | 路径 | 作用 |
|--------|------|------|
| `express.static` | `/`（web-admin 目录） | 大屏/后台/看板页面 |
| `express.static` | `/uploads` | 上传的图片/视频静态访问 |
| `express.static` | `/gallery` | 手机画廊 SPA 静态文件 |
| `express.json()` | 各 API 路由 | JSON body 解析 |
| `multer` | `/api/artworks/upload` | 单文件上传 |
| `multer` | `/api/artworks/batch` | 最多 50 张批量上传 |
| `multer` | `/api/auto-matting` | 自动抠图入口 |
| `multer` | `/api/background/upload` | 背景图上传 |
| `multer` | `/api/videos/upload` | 视频上传 |
| `multer` | `/api/cms/albums/:id/media` | CMS 媒体上传 |
| 错误处理 | 全局 | 文件大小超限等错误响应 |

### 5.2 Express 页面路由

| 路由 | 作用 |
|------|------|
| `GET /` | 重定向到 `/admin` |
| `GET /admin` | 后台管理页面 |
| `GET /admin/settings` | 后台管理页面（设置选项卡） |
| `GET /display` | 大屏展示页面 |
| `GET /dashboard` | 运营数据看板 |
| `GET /gallery` | 手机画廊 SPA |
| `GET /gallery/{path}` | 画廊静态文件 / 作品分享页 |
| `GET /work.html?id=X` | 作品页渲染（服务端 SSR） |
| `GET /work/:id` | 短链跳转到分享页 |

### 5.3 Express API 路由 — 作品管理

| 方法 | 路由 | 作用 |
|------|------|------|
| GET | `/api/artworks` | 获取作品列表（仅活跃） |
| GET | `/api/artworks/all` | 获取全部作品列表（含归档） |
| GET | `/api/artworks/stats` | 作品统计数据 |
| POST | `/api/artworks/upload` | 单张手动上传 |
| POST | `/api/artworks/batch` | 批量上传（最多 50 张） |
| POST | `/api/auto-matting` | 自动抠图上传（收件箱/飞书用） |
| PUT | `/api/artworks/:id/archive` | 下架作品 |
| PUT | `/api/artworks/:id/restore` | 恢复作品 |
| DELETE | `/api/artworks/:id/purge` | 彻底删除 |
| POST | `/api/regenerate-pages` | 重新生成静态页面 |

### 5.4 Express API 路由 — CMS 管理

| 方法 | 路由 | 作用 |
|------|------|------|
| GET | `/api/cms/config` | 获取 CMS 配置 |
| POST | `/api/cms/config` | 更新 CMS 配置 |
| GET | `/api/cms/test` | 测试 CMS 连接 |
| GET | `/api/cms/display-album` | 获取展示相册 ID |
| PUT | `/api/cms/display-album` | 设置展示相册 |
| GET | `/api/cms/albums` | 获取相册列表 |
| POST | `/api/cms/albums` | 创建相册 |
| GET | `/api/cms/albums/:id` | 获取相册详情 |
| PUT | `/api/cms/albums/:id` | 更新相册 |
| GET | `/api/cms/albums/:id/media` | 获取相册媒体列表 |
| POST | `/api/cms/albums/:id/media` | 上传媒体到相册 |
| POST | `/api/cms/albums/:id/media/add-url` | 通过 URL 添加媒体 |
| PUT | `/api/cms/albums/:id/media/:mediaId` | 更新媒体信息 |
| DELETE | `/api/cms/albums/:id/media/:mediaId` | 删除媒体 |
| POST | `/api/cms/albums/media/:mediaId/view` | 增加浏览量 |
| POST | `/api/cms/albums/media/:mediaId/like` | 点赞 |
| GET | `/api/cms/albums/:id/media/check` | 增量检查新媒体 |
| POST | `/api/cms/upload` | 上传文件到 CMS |
| PUT | `/api/cms/albums/:id/enable` | 启用/禁用相册 |
| PUT | `/api/cms/albums/:id/media/:mediaId/enable` | 启用/禁用媒体 |

### 5.5 Express API 路由 — 抠图队列

| 方法 | 路由 | 作用 |
|------|------|------|
| GET | `/api/cms/rembg-health` | 检测 Rembg 服务健康状态 |
| POST | `/api/cms/cutout/scan/:albumId` | 扫描相册中缺少抠图的媒体 |
| POST | `/api/cms/cutout/:albumId/:mediaId` | 手动触发单张抠图 |
| GET | `/api/cms/cutout/queue` | 查看抠图队列状态 |
| DELETE | `/api/cms/cutout/queue` | 清空抠图队列 |
| POST | `/api/cms/cutout/notify` | 接收 Worker 抠图完成通知 |
| POST | `/api/cms/sync` | 手动触发 CMS 全量同步 |

### 5.6 Express API 路由 — 其他

| 方法 | 路由 | 作用 |
|------|------|------|
| GET/POST/PUT | `/api/background` | 背景图 CRUD |
| POST | `/api/background/upload` | 背景图上传 |
| GET/POST/PUT/DELETE | `/api/videos/*` | 视频管理 |
| GET | `/api/analytics/today` | 当日统计数据 |
| GET | `/api/analytics/beacon` | 1x1 GIF 分析信标 |
| GET/POST | `/api/dashboard/today` | 运营看板 |

---

## 六、Rembg 服务监听

**位置：** `services/rembg/rembg-server.py`

| 路由 | 方法 | 作用 |
|------|------|------|
| `/api/remove` | POST | 接收图片，返回抠图后的 PNG |
| `/api/health` | GET | 健康检查 |

**超时：** 30 秒（Worker 侧 `req.setTimeout(30000)`）

**自愈：** `启动Rembg抠图服务.bat` 中 `:loop` 循环，崩溃后 3 秒自动重启。

---

## 七、流程图

```
┌─ 服务端 (server.js) ──────────────────────────────┐
│                                                    │
│  HTTP :3000 (Express 50+ 路由)                     │
│  Socket.IO (11 个 emit 事件 + 2 个 on 事件)        │
│                                                    │
│  ┌─ 定时轮询 ──────────────────────────────────┐   │
│  │  5s  →  pollCmsNewMedia (增量同步 CMS)       │   │
│  │  5min → 全量刷新缓存 (补漏 cutoutUrl)         │   │
│  │  2s   → 抠图队列处理 (动态 setTimeout)       │   │
│  └────────────────────────────────────────────┘   │
│                                                    │
├─ Worker (local-cutout-worker.js) ──────────────────┤
│                                                    │
│  ┌─ 定时轮询 ──────────────────────────────────┐   │
│  │  5s  →  mainLoop (增量检查 CMS 待抠图媒体)    │   │
│  │  5min →  fullScan (全量兜底补漏)             │   │
│  └────────────────────────────────────────────┘   │
│                                                    │
├─ 前端浏览器 ───────────────────────────────────────┤
│                                                    │
│  admin.js:  30s × 3 (CMS 轮询 + Rembg 检测)       │
│  display.js:  600ms / 150ms (粒子动画)            │
│                                                    │
└────────────────────────────────────────────────────┘
```
