# 常见问题与修复

## 上传失败

### 1. 返回 xxx is not defined

原因: git checkout 恢复了缺少常量的旧版本

修复: 检查 server.js 是否有以下常量定义
- REMBG_HOST / REMBG_PORT / REMBG_TIMEOUT
- ORIGINALS_DIR

### 2. 返回 Rembg timeout

原因: Rembg 服务没启动 (port 7000)

修复: 双击 start-rembg.bat

### 3. 文件在 watch-folder 不动

原因: 收件箱监听没有重试机制

修复:
- 重启收件箱监听（清空 knownFiles）
- 或手动在 Admin 上传

## 大屏问题

### 1. 新作品不显示

原因: 有视频配置时，新作品排队等视频结束（期望B逻辑）

修复: 等视频播完，或清空视频列表

### 2. 卡片消失太快

调整 MIN_LIFETIME / MAX_LIFETIME（display.js 14-15行）

### 3. 视频间隔太短/太长

去 Admin -> 视频管理 -> 调整间隔（秒）

## 收件箱监听连不上

检查:
1. B 电脑是否运行 python -m http.server 8765
2. Windows 防火墙是否放行 Python
3. config.json 里的 IP 是否正确

## 服务器崩溃

### EADDRINUSE
端口被占用 -> 杀掉旧进程再启动

### 启动后马上退出
语法错误 -> node -c server.js 检查
