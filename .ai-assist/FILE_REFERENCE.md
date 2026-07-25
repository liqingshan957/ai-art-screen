# 文件职责与关键函数

## server.js（主服务）

| 区域 | 行号 | 内容 |
|------|------|------|
| 常量定义 | 1-35 | PORT, REMBG_HOST/PORT/TIMEOUT, 目录常量 |
| 数据文件 | 36-50 | artworks.json, videos.json 等 |
| Multer 配置 | ~110 | 文件上传限制（20MB） |
| 页面路由 | ~170 | /display, /admin, / 等 |
| callRembg | ~760 | HTTP 调用 localhost:7000 抠图 |
| schedulePagefireDeploy | ~790 | 15 秒后部署到公网 |
| API: 作品管理 | ~800 | artworks CRUD |
| API: 自动抠图 | ~893 | POST /api/auto-matting (核心) |
| API: 视频管理 | ~1100 | 视频上传/删除/配置 |
| Socket.IO | ~1195 | 实时推送同步 |

### 关键常量

| 常量 | 值 | 用途 |
|------|-----|------|
| PORT | 3000 | 服务器端口 |
| REMBG_HOST | localhost | 抠图服务地址 |
| REMBG_PORT | 7000 | 抠图服务端口 |
| REMBG_TIMEOUT | 15000 | 抠图超时(ms) |
| DEDUP_WINDOW | 30000 | 防重复提交窗口(ms) |

### 裁剪配置

设计卡规格: 102mm x 152mm
- 上裁: 8/152 = 5.26%
- 左右裁: 8/102 = 7.84%
- 下裁: 32/152 = 21.05%
- 可见区域: 86mm x 112mm

## display.js（大屏逻辑）

| 区域 | 行号 | 内容 |
|------|------|------|
| 全局变量 | 1-35 | allArtworks, activeCards, spotlightQueue |
| 粒子系统 | ~60 | Particle 类 + 动画循环 |
| Socket 事件 | ~190 | artwork:new, sync, videos:update 等 |
| 视频引擎 | ~268 | restartVideoSchedule, scheduleNextVideo, playShowcaseVideo |
| Spotlight 流程 | ~348 | processSpotlightQueue, startSpotlight |
| 浮动卡片 | ~700 | FloatingCard 类 + findPosition |
| 主循环 | ~880 | requestAnimationFrame 动画循环 |

### 关键变量

| 变量 | 默认值 | 用途 |
|------|--------|------|
| FIXED_CARDS | 6 | 同时显示的卡片数 |
| MIN_LIFETIME | 10000 | 卡片最短寿命(ms) |
| MAX_LIFETIME | 20000 | 卡片最长寿命(ms) |
| spotlightSize | 动态 | 特写容器高度 = 屏幕高度 x 60% |
| originalDuration | 5500 | 特写展示时长(ms) |

### 视频配置 (videos_config.json)

| 字段 | 默认值 | 用途 |
|------|--------|------|
| interval | 300 | 视频播放间隔(秒) |
| repeat | 2 | 每次播放循环次数 |

## display.css（大屏样式）

关键选择器:
- #spotlight-image-wrap - 特写容器（left:0; top:0; 像素坐标定位）
- .floating-card - 浮动卡片（无边框阴影）
- #spotlight-layer - 特写蒙层

## inbox-watcher.js（收件箱监听）

位于: D:\桌面\开发项目\收件箱监听\

| 区域 | 功能 |
|------|------|
| 配置 | config.json 定义远程电脑地址 |
| 轮询 | 每 2 秒 HTTP GET 远程目录 |
| 下载 | 发现新文件 -> 下载到 watch-folder |
| 上传 | POST 到 /api/auto-matting -> 成功移入 printed-folder |

### 失败处理

上传失败时: 弹出通知 + 文件留在 watch-folder（不会重试）
