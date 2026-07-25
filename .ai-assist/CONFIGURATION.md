# 配置汇总

## 服务器配置 (server.js)

| 常量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3000 | 服务器端口 |
| REMBG_HOST | localhost | 抠图服务地址 |
| REMBG_PORT | 7000 | 抠图服务端口 |
| REMBG_TIMEOUT | 15000 | 抠图超时(ms) |
| DEDUP_WINDOW | 30000 | 防重复提交窗口(ms) |

## 视频配置 (data/videos_config.json)

| 字段 | 默认值 | 说明 | Admin 可调 |
|------|--------|------|-----------|
| interval | 300 | 视频播放间隔(秒) | 是 |
| repeat | 2 | 每次播放循环次数 | 是 |

## 大屏配置 (display.js)

| 常量 | 默认值 | 说明 |
|------|--------|------|
| FIXED_CARDS | 6 | 浮动卡片数 |
| MIN_LIFETIME | 10000 | 卡片最短寿命(ms) |
| MAX_LIFETIME | 20000 | 卡片最长寿命(ms) |
| originalDuration | 5500 | 特写展示时长(ms) |

## 收件箱监听 (config.json)

| 字段 | 默认值 | 说明 |
|------|--------|------|
| screenSystemUrl | http://localhost:3000 | 投屏系统地址 |
| pollInterval | 2000 | 轮询间隔(ms) |
| remotes | [{name, url}] | 远程电脑列表 |

## 裁剪配置 (server.js)

设计卡规格: 102mm x 152mm
- 上裁: 8/152
- 左右裁: 8/102
- 下裁: 32/152
- 可见区域: 86mm x 112mm
