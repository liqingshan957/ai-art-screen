# 敦煌 AIGC 艺术展 · 投屏展示系统

广州美术馆展览现场的运营工具。现场孩子用 AI 创作作品，系统自动抠图、实时投屏展示，家长扫码即可在手机上查看作品。

---

## 系统架构

```
┌─ 收件箱监听 ─────────────────────────────┐
│  轮询 B/C 电脑(172.16.29.64:8765)         │
│  发现新图片 → 下载 → POST 抠图流水线       │
└──────────────────┬───────────────────────┘
                   │ POST /api/auto-matting
                   ▼
┌─ Node.js 主服务 (port 3000) ─────────────┐
│                                          │
│  ┌→ ① Sharp 裁剪原图(按102×152mm设计卡)   │
│  │  ② HTTP → Python Rembg 抠图(port 7000)│
│  │  ③ 保存作品数据 + 生成分享页           │
│  │  ④ Socket.IO 推送到大屏               │
│  │  ⑤ 上传 CDN + PageFire 公网部署        │
│  └────────────────────────────────────── │
│                                          │
│  API: 作品管理 / 背景/视频/统计/看板       │
└──────────┬──────────────────┬────────────┘
           │ Socket.IO        │ HTTP
           ▼                  ▼
    ┌──────────────┐  ┌──────────────┐
    │ 大屏展示页    │  │ 后台管理页    │
    │ display.html │  │ admin.html   │
    │ 浮动卡片+特效 │  │ 上传/归档/配置│
    └──────────────┘  └──────┬───────┘
                             │
                     ┌──────▼───────┐
                     │ 手机分享页    │
                     │ /work/{id}   │
                     │ PageFire公网 │
                     └──────────────┘
```

## 核心地址

| 用途 | 地址 |
|------|------|
| 后台管理 | `http://localhost:3000/admin` |
| 大屏展示 | `http://localhost:3000/display` |
| 数据看板 | `http://localhost:3000/dashboard` |
| 手机作品页 | `http://localhost:3000/work/{作品ID}` |
| 公网分享 | `https://17xskjdaxiang-daxiang.pagefire.openhkt.com/works/{作品ID}.html` |

## 快速启动

```bash
cd ai-art-screen
npm install
node server.js
```

浏览器打开 `http://localhost:3000/admin` 即可。

> 如需自动抠图，还需启动 Rembg 服务（`scripts/start-rembg.bat`）和收件箱监听。

---

## 目录结构

```
ai-art-screen/
├── src/
│   └── server.js                 # 主服务（API + Socket + 抠图流水线）
├── web-admin/                      # 后台管理 + 大屏前端
│   ├── admin.html                # 后台管理
│   ├── display.html              # 大屏展示
│   ├── dashboard.html            # 数据看板
│   ├── css/                      # 样式
│   ├── js/                       # 交互逻辑
│   └── works/                    # 生成的分享页(gitignored)
├── templates/                    # 分享页 HTML 模板
│   ├── work-page.html            #  手机端作品页模板
│   └── pagefire-page.html        #  公网部署版模板
├── services/                     # 独立服务
│   └── rembg/                    #  Python AI 抠图服务
├── uploads/                      # 用户文件（gitignored）
│   ├── artworks/                 #  抠图版(透明背景)
│   ├── originals/                #  原图 + 裁剪版
│   ├── background/               #  背景图
│   └── videos/                   #  插播视频
├── data/                         # 运行时数据
│   ├── artworks.json             #  作品数据
│   ├── artworks_archive.json     #  归档记录
│   ├── analytics.json            #  访问统计
│   └── dashboard.json            #  运营看板
├── deploy/                       # 部署输出
│   └── pagefire/                 #  PageFire 公网站点
├── scripts/                      # 启动脚本
│   ├── start-screen.bat          #  Node 主服务(3000)
│   ├── start-rembg.bat           #  Python 抠图(7000)
│   └── 启动投屏系统.bat           #  一键启动
├── package.json
└── .gitignore
```

---

## 功能模块

### 1. 自动抠图流水线（核心）

收件箱监听发现新图片 → 自动完成：

```
原图 → 保存到 originals/{id}.{ext}
     → Sharp 裁剪去边距（设计卡 102×152mm）
        上裁 5.3% / 左右 7.8% / 下裁 21%
     → 保存裁剪版 originals/{id}_c.{ext}
     → HTTP POST → Rembg 服务(7000) 抠图
     → 保存抠图版 artworks/{id}.png
     → Socket.IO 推送到大屏 → 特写动画
     → 生成分享页 HTML → CDN 上传 → PageFire 部署
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
| 自动抠图 | 收件箱监听 → /api/auto-matting |
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
| Node.js + Express | HTTP 服务 / API |
| Socket.IO | 实时推送（大屏即时更新） |
| Sharp | 图片裁剪 / 格式转换 |
| Rembg (Python) | AI 背景移除 |
| Multer | 文件上传 |
| PageFire CLI | 静态站点部署 |
| Fetch API | CDN 图片上传 |

---

## FAQ

| 问题 | 原因 | 解决 |
|------|------|------|
| "Rembg timeout" | 抠图服务未启动 | 运行 `scripts/start-rembg.bat` |
| 大屏没反应 | 端口 3000 未启动 | 检查 `http://localhost:3000` |
| 新作品不显示 | 有视频配置在排队 | 等视频播完，或清空视频列表 |
| 上传失败 | 服务地址不对 | 确认收件箱监听配置中的主服务地址 |
