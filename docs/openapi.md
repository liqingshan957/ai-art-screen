# OpenAPI 开放接口

## 概述

OpenAPI 模块为第三方系统提供 RESTful 接口，使用 API Key 认证，按 Scope 授权，数据按租户隔离。

**基准 URL：** `https://vapi.hkting.com/api/open-api/v1`

**认证方式：** 在请求头携带 `X-Api-Key`，值为平台生成的 API 密钥（格式：`ak_` + 40 位随机字符）。

---

## 快速开始

### 1. 创建 API Key

登录管理后台 → **我的平台 → API密钥** → 创建密钥 → 选择权限模块 → 复制密钥。

> ⚠️ 密钥只在创建时显示一次，关闭后无法再次查看，请妥善保存。

### 2. 测试连通性

```bash
curl https://vapi.hkting.com/api/open-api/v1/tenant/profile \
  -H "X-Api-Key: ak_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

成功返回：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "tenantId": "xxx",
    "platformName": "我的平台"
  },
  "timestamp": 1700000000000
}
```

---

## 接口规范

### 响应格式

所有接口统一返回 JSON 对象，顶层字段固定：

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | int | 0=成功，非0=错误码 |
| `message` | string | 提示信息 |
| `data` | T | 业务数据（见下方三种形态） |
| `timestamp` | long | 服务器时间戳（毫秒） |

#### 响应形态

根据端点类型，`data` 有三种形态：

**① 单对象**
```json
{ "code": 0, "data": { "tenantId": "xxx", "platformName": "我的平台" }, ... }
```

**② 列表**
```json
{ "code": 0, "data": [ { "albumId": 1 }, { "albumId": 2 } ], ... }
```
空列表时返回 `[]`，不会返回 `null`。

**③ 分页**（列表端点带 `pageNum/pageSize` 参数时）
```json
{ "code": 0, "data": { "total": 100, "rows": [...], "pageNum": 1, "pageSize": 20 }, ... }
```

**④ 错误**
```json
{ "code": 40401, "message": "活动不存在", "data": null, ... }
```

> 客户端判断成功/失败的依据：`code === 0`。不要依赖 `data !== null` 来判断成功，因为成功接口的 data 可能为空数组 `[]`。

### 错误码

| code | HTTP状态 | 说明 |
|------|---------|------|
| 0 | 200 | 成功 |
| 40001 | 400 | 参数错误 |
| 40101 | 401 | 缺少 API Key |
| 40102 | 401 | API Key 无效 |
| 40103 | 401 | API Key 已过期 |
| 40301 | 403 | 无此模块权限（Scope 不足） |
| 40401 | 404 | 资源不存在 |
| 50001 | 500 | 服务器内部错误 |

### 租户隔离

OpenAPI 的租户隔离分两层，无需调用方关心：

**① 数据访问层（MyBatis Plus 拦截器自动注入）**

系统内置 `TenantLineInnerInterceptor`，解析 SQL 时自动为所有 `hkt_*` 表（排除白名单表）追加 `AND tenant_id = ?`。
OpenAPI 请求通过 API Key 绑定关系拿到 `tenantId` 后写入线程上下文，拦截器即可自动注入。**无需在 Mapper XML 中手动写 `tenant_id = #{tenantId}` 条件。**

**② 业务逻辑层（手动校验）**

增删改操作在 Service 层额外执行一次 `tenantId` 归属校验，防止越权操作（如跨租户删除数据）。

**调用方无需传递租户 ID，也无法越权访问其他租户数据。**

---

## 接口列表

### 1. 租户信息

#### 获取当前租户信息

```http
GET /open-api/v1/tenant/profile
X-Api-Key: ak_xxx...

Scope: platform
```

**响应示例：**
```json
{
  "code": 0,
  "data": {
    "tenantId": "18e69d67533647f3b867",
    "platformName": "我的平台",
    "platformLogo": "https://img.hkting.com/...png",
    "platformDesc": "平台描述",
    "slogan": "标语",
    "contactPerson": "联系人",
    "contactPhone": "13800138000",
    "contactEmail": "admin@example.com",
    "province": "广东省",
    "city": "深圳市",
    "address": "南山区"
  }
}
```

---

### 2. 文件上传

上传图片、视频、文档等文件，自动识别类型并按分类处理。

#### 支持的文件类型

| 分类 | 扩展名 | 支持的处理模式 |
|------|--------|---------------|
| image | jpg/jpeg/png/gif/webp/bmp/svg/ico | original, compress, resize_fit, resize_cover, resize_fill |
| video | mp4/mov/avi/mkv/webm/flv/wmv/m4v/ts | original, compress |
| document | pdf/doc/docx/xls/xlsx/ppt/pptx/txt/csv/md/xml/json/html | original |
| audio | mp3/wav/aac/ogg/flac/m4a/wma/opus | original |
| archive | zip/rar/7z/tar/gz/bz2/xz/zstd | original |

#### 处理模式说明

| 模式 | 适用类型 | 说明 |
|------|---------|------|
| `original` | 全部 | 原文件上传，不做任何处理 |
| `compress` | image/video | 按 `quality` + `maxWidth` 压缩 |
| `resize_fit` | image | 等比例缩放适配到 `maxWidth` × `maxHeight` 内 |
| `resize_cover` | image | 缩放并居中裁剪填满指定尺寸 |
| `resize_fill` | image | 强制拉伸到指定宽高（可能变形） |

> 选择当前文件类型不支持的模式时，自动降级为 `original`，不会报错。

#### 上传文件

```http
POST /open-api/v1/files/upload
X-Api-Key: ak_xxx...
Content-Type: multipart/form-data

file: MultipartFile          (必填)
albumId: Long                (选填，仅图片可关联平台相册)
mode: String                 (选填，默认 compress)
quality: Float               (选填，默认 0.85)
maxWidth: Integer            (选填，默认 1920)
maxHeight: Integer           (选填，默认同 maxWidth)
```

**响应示例：**
```json
{
  "code": 0,
  "data": {
    "url": "https://img.hkting.com/.../photo.jpg",
    "category": "image",
    "format": "jpg",
    "fileSize": 102400,
    "originalFilename": "photo.jpg",
    "mimeType": "image/jpeg",
    "mode": "compress",
    "width": 1920,
    "height": 1080,
    "albumId": 1
  }
}
```

#### 获取文件分类信息

```http
GET /open-api/v1/files/categories
X-Api-Key: ak_xxx...

Scope: image
```

返回所有支持的文件分类、扩展名和处理模式。

---

### 3. 平台相册（只读）

平台相册是装修素材图片库，数据按相册分组，图片以 JSON 数组存储。

#### 查询相册列表

```http
GET /open-api/v1/albums?pageNum=1&pageSize=20
X-Api-Key: ak_xxx...

Scope: image
```

#### 查询相册详情

```http
GET /open-api/v1/albums/{id}
X-Api-Key: ak_xxx...

Scope: image
```

---

### 4. 活动管理

#### 创建活动

```http
POST /open-api/v1/activities
X-Api-Key: ak_xxx...
Content-Type: application/json


Scope: activity
```

**请求参数：**

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| activityTitle | string | 是 | - | 活动标题 |
| activityDesc | string | 否 | - | 活动简介 |
| activityContent | string | 否 | - | 活动详细内容（HTML/富文本） |
| category | string | 否 | - | 分类: tech/business/social/training/entertainment/charity |
| organizerName | string | 否 | - | 主办方名称 |
| activityLocation | string | 否 | - | 活动地点 |
| startTime | string | 是 | - | 开始时间 `yyyy-MM-dd HH:mm` |
| endTime | string | 是 | - | 结束时间 `yyyy-MM-dd HH:mm` |
| registrationDeadline | string | 否 | - | 报名截止时间 `yyyy-MM-dd HH:mm` |
| coverImage | string | 否 | - | 封面图片 URL |
| maxParticipants | int | 否 | 0 | 最大参与人数（0=不限） |
| registrationFee | number | 否 | 0 | 报名费用 |
| activityTags | string | 否 | - | 标签（逗号分隔） |
| activityImages | string | 否 | - | 活动图片 JSON 数组，如 `["url1","url2"]` |
| publishScope | string | 否 | "private" | 公开范围: private=仅租户内, public=公域发现 |
| publishImmediately | bool | 否 | true | 是否创建后立即发布 |

#### 发布活动

```http
PUT /open-api/v1/activities/{id}/publish
X-Api-Key: ak_xxx...

Scope: activity
```

将草稿状态的活动发布为已发布。

#### 获取活动详情

```http
GET /open-api/v1/activities/{id}
X-Api-Key: ak_xxx...

Scope: activity
```

#### 获取活动报名列表

```http
GET /open-api/v1/activities/{id}/registrations
X-Api-Key: ak_xxx...

Scope: activity
```

---

### 5. 活动相册

活动相册是活动的图片/视频集，每条媒体独立存储，支持命名。4 种图片形态：

| 字段 | 含义 | 说明 |
|------|------|------|
| `mediaUrl` | 展示图/裁剪后图 | 用户上传时自动缩放得到；裁剪后替换为此值 |
| `sourceUrl` | 源图（原始文件） | 原始上传文件，永久不变；第三方接口处理原图用此值 |
| `cutoutUrl` | AI抠图结果 | 可选，需调用抠图接口异步生成 |
| `thumbnailUrl` | 缩略图 | 网格列表用 |

#### 查询相册列表（分页）

```http
GET /open-api/v1/activity-albums?activityId=160&pageNum=1&pageSize=20
X-Api-Key: ak_xxx...

Scope: activity
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| activityId | integer | 否 | - | 活动ID（不传则查全部） |
| pageNum | integer | 否 | 1 | 页码 |
| pageSize | integer | 否 | 20 | 每页条数 |

**响应（分页，不含 mediaList，仅含 mediaCount）：**
```json
{
  "code": 0,
  "data": {
    "total": 5,
    "rows": [
      {
        "albumId": 1,
        "activityId": 160,
        "albumName": "活动现场",
        "coverImage": "https://...",
        "albumStatus": "1",
        "mediaCount": 12,
        "viewCount": 120,
        "createTime": "2026-07-22 10:00:00"
      }
    ],
    "pageNum": 1,
    "pageSize": 20
  }
}
```

#### 获取相册详情（含媒体列表）

```http
GET /open-api/v1/activity-albums/{id}
X-Api-Key: ak_xxx...

Scope: activity
```

返回相册信息 + 所有媒体列表。

#### 创建相册

```http
POST /open-api/v1/activity-albums
X-Api-Key: ak_xxx...
Content-Type: application/json

Note: activityId is optional when creating an activity album. albumName is required; albumStatus and location are optional.

{
  "albumName": "活动现场",
  "albumStatus": "1",
  "location": "深圳"
}
```

#### 更新相册

```http
PUT /open-api/v1/activity-albums/{id}
X-Api-Key: ak_xxx...
Content-Type: application/json

{ "albumName": "新名称", "coverImage": "https://...", "albumStatus": "1" }
```

**请求参数（全部选填，只传需要改的字段）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| albumName | string | 相册名称 |
| coverImage | string | 封面图片 URL |
| albumStatus | string | 状态: 0=草稿, 1=已发布 |
| location | string | 地点 |
| albumTime | string | 活动时间 `yyyy-MM-dd HH:mm` |
| sortOrder | int | 排序号 |

#### 添加媒体到相册（支持服务端裁剪）

```http
POST /open-api/v1/activity-albums/{id}/media
X-Api-Key: ak_xxx...
Content-Type: application/json

{
  "mediaUrl": "https://img.hkting.com/api/profile/upload/xxx.jpg",
  "mediaType": "image",
  "mediaName": "签到照片",
  "sourceUrl": "https://img.hkting.com/api/profile/upload/xxx.jpg",
  "cropX": 98,
  "cropY": 47,
  "cropWidth": 1054,
  "cropHeight": 663
}
```

**请求体（JSON）：**

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| mediaUrl | string | 否* | - | 展示图 URL（裁剪后自动替换此值） |
| mediaType | string | 否 | image | image / video |
| mediaName | string | 否 | - | 媒体名称/标题 |
| thumbnailUrl | string | 否 | - | 缩略图 URL（视频建议传） |
| sourceUrl | string | 否 | - | 源图 URL（原始文件，裁剪/抠图时使用） |
| cropX | integer | 否 | - | 裁剪起始 X 坐标 |
| cropY | integer | 否 | - | 裁剪起始 Y 坐标 |
| cropWidth | integer | 否 | - | 裁剪宽度 |
| cropHeight | integer | 否 | - | 裁剪高度 |
| naturalWidth | integer | 否 | - | 前端展示宽度（传了则后端按比例换算坐标到自然像素） |
| naturalHeight | integer | 否 | - | 前端展示高度 |

> *mediaUrl 的条件规则：
> - **不传 mediaUrl**：必须同时传 `sourceUrl` + `cropX/cropY/cropWidth/cropHeight`，服务端从源图裁剪生成展示图
> - **传 mediaUrl + 裁剪参数**：mediaUrl 被裁剪结果覆盖，传什么值无所谓
> - **传 mediaUrl + sourceUrl（无 crop）**：各自独立存储
> - **不传 mediaUrl 且裁剪参数不完整**：返回 40001 错误，提示缺少哪些参数

Scope: activity

#### 获取媒体列表（分页）

```http
GET /open-api/v1/activity-albums/{id}/media?pageNum=1&pageSize=50
X-Api-Key: ak_xxx...

Scope: activity
```

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| id | integer | 是 | - | 相册ID（路径参数） |
| pageNum | integer | 否 | 1 | 页码 |
| pageSize | integer | 否 | 50 | 每页条数 |

#### 检查相册新增媒体（游标 + 上限，适合轮询）

```http
GET /open-api/v1/activity-albums/{id}/media/check?sinceId=290&limit=50
X-Api-Key: ak_xxx...

Scope: activity
```

查询相册中是否有新增媒体，**基于 mediaId 自增主键游标**，不受时间误差影响。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| id | integer | 是 | - | 相册ID（路径参数） |
| sinceId | integer | 是 | - | 上次看到的最后一个 mediaId，返回比此 ID 大的新媒体 |
| limit | integer | 否 | 50 | 最多返回条数（最大 200，防止轮询爆量） |

**响应示例（有新增）：**
```json
{
  "code": 0,
  "data": [
    { "mediaId": 294, "mediaType": "image", "mediaName": "签到台照片", "mediaUrl": "https://...", "sourceUrl": null, "cutoutUrl": null, "thumbnailUrl": null, "createTime": "2026-07-22 22:19:17" }
  ]
}
```
空数组 `[]` 表示无新增媒体。

#### 获取单个媒体详情

```http
GET /open-api/v1/activity-albums/media/{mediaId}
X-Api-Key: ak_xxx...

Scope: activity
```

返回单个媒体的完整信息，含所有图片形态的 URL。

**响应示例：**
```json
{
  "code": 0,
  "data": {
    "mediaId": 294,
    "mediaType": "image",
    "mediaName": "签到台照片",
    "mediaUrl": "https://img.hkting.com/...display.jpg",
    "sourceUrl": "https://img.hkting.com/...original.png",
    "cutoutUrl": null,
    "thumbnailUrl": null,
    "sortOrder": 0,
    "viewCount": 15,
    "createTime": "2026-07-22 22:19:17"
  }
}
```

#### 删除媒体

```http
DELETE /open-api/v1/activity-albums/{id}/media/{mediaId}
X-Api-Key: ak_xxx...

Scope: activity
```

#### 更新媒体（重命名/改排序/更新裁剪/抠图结果等）

```http
PUT /open-api/v1/activity-albums/{id}/media/{mediaId}
X-Api-Key: ak_xxx...
Content-Type: application/json

Scope: activity
```

**请求参数（全部选填，只传需要改的字段）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| mediaName | string | 媒体名称/标题 |
| mediaUrl | string | 展示图 URL（裁剪后替换此值） |
| sourceUrl | string | 源图 URL（原始文件） |
| cutoutUrl | string | AI 抠图结果 URL |
| thumbnailUrl | string | 缩略图 URL |
| sortOrder | integer | 排序号 |

#### 媒体浏览 +1

```http
POST /open-api/v1/activity-albums/media/{mediaId}/view
X-Api-Key: ak_xxx...

Scope: activity
```

#### 媒体点赞 +1

```http
POST /open-api/v1/activity-albums/media/{mediaId}/like
X-Api-Key: ak_xxx...

Scope: activity
```

---

## Scope 模块说明

创建 API Key 时可选择以下权限模块：

| Scope | 包含接口 | 说明 |
|-------|---------|------|
| `platform` | 租户信息 | 读取当前租户基本资料 |
| `image` | 文件上传、平台相册 | 文件上传管理与图片库访问 |
| `activity` | 活动管理、活动相册 | 活动的增删改查与报名数据 |
| `ai-tool` | AI工具管理 | （预留） |
| `card` | 名片管理 | （预留） |
| `shop` | 商城管理 | （预留） |

---

## MCP 集成

MCP（Model Context Protocol）Server 位于 `mcp-server/` 目录，将上述 REST API 暴露为 MCP Tools，可供 Claude Desktop / Cursor 等 MCP 客户端直接调用。

### 架构

```
MCP 客户端（Claude Desktop / Cursor）
    │  stdin/stdout
    ▼
mcp-server/dist/index.js          ← Node.js MCP Server
    │  HTTPS (X-Api-Key)
    ▼
vapi.hkting.com/api/open-api/v1/*  ← Spring Boot 后端
```

### 配置 Claude Desktop

编辑 `%APPDATA%\Claude\claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "hkt-openapi": {
      "command": "node",
      "args": ["E:/job/projects/hkt/products/ai-card/mcp-server/dist/index.js"],
      "env": {
        "HKT_API_KEY": "ak_xxxxxxxxxxxxxxxxxxxxxxxxx",
        "HKT_API_BASE": "https://vapi.hkting.com/api"
      }
    }
  }
}
```

重启 Claude Desktop 后生效。

### MCP Tool 列表

| Tool 名称 | 对应 API | 说明 |
|-----------|---------|------|
| `tenant_profile` | `GET /tenant/profile` | 当前租户信息 |
| `file_upload` | `POST /files/upload` | 上传文件 |
| `file_categories` | `GET /files/categories` | 文件分类查询 |
| `album_list` | `GET /albums` | 平台相册列表 |
| `album_detail` | `GET /albums/{id}` | 平台相册详情 |
| `activity_create` | `POST /activities` | 创建活动 |
| `activity_publish` | `PUT /activities/{id}/publish` | 发布活动 |
| `activity_detail` | `GET /activities/{id}` | 活动详情 |
| `activity_registrations` | `GET /activities/{id}/registrations` | 活动报名列表 |
| `activity_album_list` | `GET /activity-albums`（分页） | 活动相册列表，不返回媒体明细 |
| `activity_album_detail` | `GET /activity-albums/{id}` | 活动相册详情（含媒体列表） |
| `activity_album_create` | `POST /activity-albums` | 创建活动相册 |
| `activity_album_update` | `PUT /activity-albums/{id}` | 更新活动相册 |
| `activity_album_add_media` | `POST /activity-albums/{id}/media` | 添加媒体（支持裁剪参数） |
| `activity_album_media_list` | `GET /activity-albums/{id}/media`（分页） | 相册媒体列表 |
| `activity_media_view` | `POST /activity-albums/media/{id}/view` | 媒体浏览+1 |
| `activity_media_like` | `POST /activity-albums/media/{id}/like` | 媒体点赞+1 |
| `activity_album_check_new_media` | `GET /activity-albums/{id}/media/check?sinceId=&limit=` | 检查相册新增媒体（游标+上限） |
| `activity_album_get_media` | `GET /activity-albums/media/{mediaId}` | 获取单个媒体详情 |
| `activity_album_delete_media` | `DELETE /activity-albums/{id}/media/{mediaId}` | 删除相册中的媒体 |
| `activity_album_update_media` | `PUT /activity-albums/{id}/media/{mediaId}` | 更新相册中的媒体（支持 sourceUrl/cutoutUrl） |

### MCP 用法示例

配置完成后，在 Claude Desktop 中可直接用自然语言操作：

> **"查一下当前租户信息"** → 调 `tenant_profile`
>
> **"给活动166创建一个相册叫「活动现场」"** → 调 `activity_album_create`
>
> **"把这个封面图加到相册里，命名为签到台照片"** → 调 `activity_album_add_media`
>
> **"创建活动，明天下午2点到5点，标题是产品发布会，自动发布"** → 调 `activity_create`

### 手动测试 MCP Server

```bash
cd mcp-server
set HKT_API_KEY=ak_xxx...
set HKT_API_BASE=https://vapi.hkting.com/api

# 列表工具
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/index.js

# 调用工具
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tenant_profile","arguments":{}}}' | node dist/index.js
```

---

## API Key 管理

管理后台 → **我的平台 → API密钥**：

- **创建**：指定名称、过期时间、权限模块
- **查看**：列表显示密钥前缀（`ak_xxxx****`）、状态、过期时间、最后使用时间、调用次数
- **删除**：删除后不可恢复
- **调用日志**：记录每次调用的 IP、路径、耗时、状态

---

## 变更记录

| 日期 | 版本 | 变更内容 |
|------|------|---------|
| 2026-07-28 | 1.1 | 活动相册：新增 sourceUrl/cutoutUrl 字段；添加媒体支持服务端裁剪参数；列表/媒体列表加分页；checkNewMedia 加 limit；新增详情/媒体列表 MCP Tool |
| 2026-07-22 | 1.0 | 初始版本：租户信息、文件上传、活动管理、活动相册、平台相册 |
