# 部署文档 — AI Art Screen（投屏展示系统）

## 服务器

| | |
|---|---|
| IP | 8.138.237.225 |
| SSH | `ssh -i docs/deploy/hkt.pem root@8.138.237.225` |
| 系统 | AlmaLinux |
| 部署目录 | `/opt/ai-art-screen` |
| PM2 进程名 | `ai-art-screen` |

## 访问地址

| 用途 | 地址 |
|------|------|
| 后台管理 | https://art.hkting.com/admin |
| 大屏展示 | https://art.hkting.com/display |
| 数据看板 | https://art.hkting.com/dashboard |
| 作品画廊 | https://art.hkting.com/gallery |

## 启动/管理

```bash
# SSH 登录
ssh -i docs/deploy/hkt.pem root@8.138.237.225

# 查看状态
pm2 status
pm2 logs ai-art-screen

# 重启
pm2 restart ai-art-screen

# 查看日志
tail -f /opt/ai-art-screen/data/*.log
```

## 更新部署

```bash
# 本地打包上传
cd ai-art-screen
tar czf /tmp/ai-art-screen.tar.gz \
  --exclude=node_modules --exclude=uploads --exclude=.git \
  --exclude=.mcp.json --exclude=data/cms-*.json \
  --exclude=data/cutout-queue.json --exclude=scripts/temp \
  --exclude=test_batch2 --exclude=services/rembg/model_cache \
  --exclude=services/rembg/server.err \
  .
scp -i docs/deploy/hkt.pem /tmp/ai-art-screen.tar.gz root@8.138.237.225:/opt/ai-art-screen/

# 服务器端解压重启
ssh -i docs/deploy/hkt.pem root@8.138.237.225 "
  cd /opt/ai-art-screen
  tar xzf ai-art-screen.tar.gz
  rm ai-art-screen.tar.gz
  mkdir -p web-gallery/data web-gallery/works
  npm install --production
  pm2 restart ai-art-screen
"
```

## 证书管理

```bash
# 查看证书到期
bash docs/deploy/cert-manage.sh status

# 手动续期
bash docs/deploy/cert-manage.sh renew
```

证书通过 Let's Encrypt + Certbot 自动续期，配置文件在 `/etc/nginx/conf.d/art_443.conf`。
