# 部署指南

## 作品展示端（纯静态，可独立部署）

`web/gallery/` 目录下的所有文件都是纯前端静态文件，可部署到任何静态托管服务。

### 部署内容

```
web/gallery/
├── index.html            # 作品画廊
├── works/                # 预生成作品详情页
│   └── {id}.html
└── data/
    └── works-data.json   # 作品列表快照（需服务端生成）
```

### 部署步骤

1. **在运行中的服务端上传作品**（`/api/artworks/upload` 或自动抠图）
2. **复制 `web/gallery/` 目录** 到静态托管服务

### 数据源说明

画廊页使用**双数据源策略**：
- **在线模式**：优先请求 `/api/artworks`（需要后端 API）
- **离线模式**：API 不可用时，自动降级到 `data/works-data.json`（静态快照）

静态部署时作品数据是快照，如需最新数据需重新生成 `works-data.json`。

### 常见静态托管

| 平台 | 上传方式 |
|------|---------|
| PageFire | `npx pagefire deploy --dir web/gallery` |
| GitHub Pages | 推送到 `gh-pages` 分支的 `web/gallery/` 目录 |
| 阿里云 OSS | `ossutil cp -r web/gallery/ oss://bucket/` |
| 腾讯云 COS | `coscli cp -r web/gallery/ cos://bucket/` |

## 完整系统部署

完整系统依赖 Node.js 后端（API + Socket.IO + 抠图），推荐在局域网服务器运行：

```bash
npm install
npm start
# 浏览器打开 http://localhost:3000/admin
```

### 可选服务

- **Rembg 抠图服务**：Python 服务，`scripts/start-rembg.bat`
- **收件箱监听**：独立项目，轮询上传目录自动触发抠图
