# HKT PicDash — Chrome 插件使用指引

快速上传网页图片或本地图片到 HKT 活动相册的 Chrome 扩展（MV3）。

## 安装

> 文件：`docs/hkt-picdash-v0.1.0.zip`

```text
1. 解压 hkt-picdash-v0.1.0.zip
2. Chrome 地址栏打开 chrome://extensions
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择解压后的文件夹（含 manifest.json 的那一层）
```

## 配置

1. 在扩展列表找到 **HKT PicDash** → 详细信息 → 扩展程序选项
2. 填写 API Key（需要 `image` + `activity` 两个 Scope）
3. 填写相册名称 → 点击「创建活动相册」

API 地址已内置：`https://vapi.hkting.com/api/open-api/v1`

## 上传方式

| 方式 | 操作 |
|------|------|
| 网页图片悬停 | 鼠标移到网页图片上 → 点击出现的「上传」按钮 |
| 右键菜单 | 右键网页图片 → 选择「上传图片到 HKT 活动相册」 |
| 侧边栏拖拽 | 点击插件图标打开侧边栏 → 拖入或选择本地图片 |
| 侧边栏选取 | 点击上传区域 → 选择图片 |

上传前可预览，上传后自动刷新相册图片列表。

## 其他

- 创建相册后可复制最近上传图片的 URL
- 设置页的「扩展程序选项」也可创建活动相册

详细说明见源码内的 `INSTALL_GUIDE.md` 和 `PLUGIN_USAGE.md`。
