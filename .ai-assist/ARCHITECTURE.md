# 系统架构

## 整体拓扑

`
B 电脑 (172.16.29.64:8765) --+
                              | HTTP 轮询
C 电脑 (172.16.29.65:8765) --+ 每 2 秒
                              |
                     +-------+----------+
                     |  收件箱监听       |
                     |  inbox-watcher.js |
                     |  下载 -> 上传      |
                     +-------+----------+
                             | POST /api/auto-matting
                             v
                +------------------------+
                |  主服务器 (port 3000)  |
                |  server.js             |
                |                        |
                |  1 multer 接收文件      |
                |  2 sharp 裁剪原图      |
                |  3 rembg (7000) 抠图   |
                |  4 保存作品数据         |
                |  5 socket.io 推送大屏   |
                +----+-----------+------+
                     |           |
             socket.io          HTTP
                     v           v
           +------------+  +------------+
           |  大屏展示    |  |  Admin 后台 |
           | display.html|  | admin.html |
           +------------+  +------------+
`

## 三个独立服务

| 服务 | 端口 | 启动方式 | 功能 |
|------|------|----------|------|
| 主服务器 | 3000 | node server.js | API + 页面 + Socket.IO |
| Rembg 抠图 | 7000 | 启动Rembg抠图服务.bat | Python 背景移除 |
| 收件箱监听 | - | node inbox-watcher.js | 轮询 B/C 电脑 |

## 目录结构

`
投屏系统/
+-- server.js                 # 主服务（API + Socket + 抠图）
+-- start-*.bat               # 启动脚本
+-- public/
|   +-- display.html          # 大屏展示页
|   +-- admin.html            # 后台管理页
|   +-- css/display.css       # 大屏样式
|   +-- js/display.js         # 大屏逻辑
|   +-- js/admin.js           # 后台逻辑
|   +-- uploads/
|       +-- artworks/         # 抠图版作品
|       +-- originals/        # 原图 + 裁剪版 (_c)
|       +-- background/       # 背景图
|       +-- videos/           # 插播视频
+-- data/                     # 运行时数据（不入库）
|   +-- artworks.json
|   +-- videos.json
|   +-- videos_config.json
+-- .ai-assist/               # AI 开发管理文档
+-- .workbuddy/               # 项目记忆
`

## 关键数据流

`
收件箱监听上传:
  原图 -> multer 临时文件 -> sharp 裁剪 -> 保存裁剪版 originals/{id}_c
                               -> rembg 抠图 -> 保存 artworks/{id}.png
                               -> 创建作品数据 -> socket.io 推送

大屏展示:
  收到 artwork:new -> 有 originalUrl? -> 特写流程 -> 浮动卡片
                                 无?   -> 直接补卡片

Admin 手动上传:
  图片 -> 直接保存 artworks/ -> 推送 -> 直接补卡片（无特写）

视频插播:
  定时器 -> 全屏播放视频 -> 结束后检查 spotlight 队列 -> 恢复画廊
`
