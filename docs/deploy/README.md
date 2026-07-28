# 部署文档 — AI Art Screen（投屏展示系统）

> 服务器具体信息（IP、SSH 命令等）在 `DEPLOY_PRIVATE.md`（不提交 Git），
> 首次部署请参考该文件填写模板。

## 准备工作

- Node.js (>=18)
- PM2（`npm install -g pm2`）
- Nginx（需配置 WebSocket 代理）
- 域名 SSL 证书（推荐 Let's Encrypt）

## 部署步骤

```bash
# 1. 上传项目到服务器
tar czf /tmp/ai-art-screen.tar.gz \
  --exclude=node_modules --exclude=uploads --exclude=.git \
  --exclude=.mcp.json --exclude=data/cms-*.json \
  --exclude=data/cutout-queue.json --exclude=scripts/temp \
  --exclude=test_batch2 --exclude=services/rembg/model_cache \
  .
scp -i <密钥> /tmp/ai-art-screen.tar.gz <用户>@<IP>:/opt/ai-art-screen/

# 2. 服务器端安装启动
ssh -i <密钥> <用户>@<IP> "
  cd /opt/ai-art-screen
  tar xzf ai-art-screen.tar.gz
  rm ai-art-screen.tar.gz
  mkdir -p web-gallery/data web-gallery/works
  npm install --production
  pm2 start server.js --name ai-art-screen
  pm2 save
"
```

## Nginx 配置参考

```nginx
server {
    listen 443 ssl;
    server_name <域名>;

    ssl_certificate /etc/letsencrypt/live/<域名>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<域名>/privkey.pem;

    client_max_body_size 50M;

    # Socket.IO WebSocket
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name <域名>;
    return 301 https://$host$request_uri;
}
```

## 服务管理

```bash
pm2 status                     # 查看状态
pm2 logs ai-art-screen         # 查看日志
pm2 restart ai-art-screen      # 重启
pm2 stop ai-art-screen         # 停止
pm2 startup                    # 开机自启
```

## 证书管理

```bash
# 申请证书（首次）
certbot --nginx -d <域名>

# 查看证书到期
bash docs/deploy/cert-manage.sh status

# 手动续期
bash docs/deploy/cert-manage.sh renew
```

证书通过 Let's Encrypt + Certbot 自动续期。
