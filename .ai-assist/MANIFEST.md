# AI 开发管理体系 · 项目清单

> 本目录是 AI 辅助开发的"入口文档"，AI 应先阅读此文件了解项目结构。

## 项目简介

**敦煌AIGC艺术展 · 投屏展示系统**

广州美术馆展览现场的运营工具。包含三大模块：
1. **大屏作品展示**（电视/投影）
2. **手机端作品页分享**（家长扫码查看）
3. **后台管理**（上传、统计）

技术栈：Node.js + Express + Socket.IO + Rembg（抠图）+ Sharp（裁剪）

## 文档索引

| 文件 | 用途 | AI 必读 |
|------|------|---------|
| ARCHITECTURE.md | 系统架构、数据流、部署拓扑 | ✅ |
| FILE_REFERENCE.md | 每个文件的职责、关键函数、常量 | ✅ |
| DEVELOPMENT_GUIDE.md | 开发规范、安全修改流程、测试 | ✅ |
| CONFIGURATION.md | 所有可配置项汇总 | 按需 |
| TROUBLESHOOTING.md | 常见问题、已知 Bug、修复记录 | 按需 |
| CHANGE_LOG.md | 历次修改记录 | 参考 |

## 核心原则

1. **先读文档，后改代码** — 特别是 ARCHITECTURE.md 和 FILE_REFERENCE.md
2. **改前先 git commit** — 把当前版本提交了再动手
3. **每次只改一个功能** — 改完测试通过再提交
4. **不改运行时数据文件** — data/artworks.json 等是动态数据

## 快速开始

`ash
cd 投屏系统
node server.js           # 启动服务 → http://localhost:3000
# 或双击 启动投屏系统.bat
`

## 仓库地址

https://github.com/liqingshan957/ai-art-screen