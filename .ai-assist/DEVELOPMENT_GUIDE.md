# 开发规范与安全流程

## 第一原则

> 改代码之前，先把当前版本 git commit 提交了再改！
> 每改完一个功能，测试通过就提交一次。
> 这样 git checkout 恢复的是上一个完整版本，不会丢东西。

## 安全修改流程

### 1. 备份当前版本

`ash
git add server.js display.js display.css  # 只加代码文件
git commit -m 'backup before 修改内容'
`

### 2. 每次只改一个功能

`
错误的做法：
  一次改 server.js 5 个地方 + display.js 3 个地方
  -> 崩了不知道哪里崩的

正确的做法：
  第一轮：只改 server.js 加裁剪 -> 测试 -> commit
  第二轮：只改 display.js 改特写 -> 测试 -> commit
  第三轮：只改 display.js 改视频 -> 测试 -> commit
`

### 3. 改完后先语法检查

`ash
node -c server.js       # 检查 JS 语法
node -c display.js
`

### 4. 重启服务测试

`ash
# 重启后才能加载新代码
`

### 5. 出现问题立即回滚

`ash
git checkout -- server.js   # 回到改动前的版本
`

## AI 开发规范

### 给 AI 的指令模板

每次开始新任务前，AI 应先读取 .ai-assist 目录下的相关文档。

### 不改的文件

- data/*.json - 运行时数据，动态变化，不入库
- node_modules/ - 依赖包
- uploads/ - 用户上传文件

### 可改的文件

| 文件 | 风险 | 说明 |
|------|------|------|
| server.js | 高 | 主服务，改动需谨慎 |
| display.js | 中 | 大屏逻辑，改动需测试 |
| display.css | 低 | 样式 |
| inbox-watcher.js | 中 | 监听逻辑（在另一目录） |

### 测试清单

改完后验证以下功能：

1. 服务器启动无报错
2. /api/artworks 返回作品列表
3. /api/auto-matting 上传测试通过
4. 大屏展示页可打开
5. 视频插播正常运行
6. 特写效果正常

## 常犯的错误（避免！）

| 错误 | 后果 | 预防 |
|------|------|------|
| 改代码前没 git commit | 回滚会丢失工作 | 改前先 commit |
| 一次改太多文件 | 出问题难定位 | 一次只改一个功能 |
| 没语法检查就重启 | 服务器崩了 | node -c 检查 |
| 改了运行时数据文件 | 数据被 commit | 别动 data/ 目录 |
| 漏加常量/变量 | 运行时 ReferenceError | 改了函数检查依赖的常量 |
