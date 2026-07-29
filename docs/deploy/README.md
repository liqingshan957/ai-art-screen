# 部署文档 — AI Art Screen（投屏展示系统）

> **服务器实际信息（IP、域名、SSH 命令等）请在 `DEPLOY_PRIVATE.md` 中查看，**  
> 本文件仅包含通用参考配置。

---

## 准备工作

- Node.js (>=18)
- PM2（`npm install -g pm2`）
- Nginx（需配置 WebSocket 代理）
- 域名 SSL 证书（推荐 Let's Encrypt）

## 部署方式

详细部署命令（含服务器 IP、SSH 密钥路径等）→ **[`DEPLOY_PRIVATE.md`](DEPLOY_PRIVATE.md)**

两种方式：

| 方式 | 适用场景 |
|------|----------|
| Git Pull | 日常更新（服务器上 `git pull` + `pm2 restart`） |
| 全量上传 | 首次部署或 Git 不可用时（tar + scp） |

---

## Nginx 配置参考

```nginx
server {
    listen 443 ssl;
    server_name <你的域名>;

    ssl_certificate /etc/letsencrypt/live/<你的域名>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<你的域名>/privkey.pem;

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
    server_name <你的域名>;
    return 301 https://$host$request_uri;
}
```

---

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
certbot --nginx -d <你的域名>

# 查看证书到期
bash docs/deploy/cert-manage.sh status

# 手动续期
bash docs/deploy/cert-manage.sh renew
```

证书通过 Let's Encrypt + Certbot 自动续期。
