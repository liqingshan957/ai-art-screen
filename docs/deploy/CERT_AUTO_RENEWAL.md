# 证书与自动续期 · 实施记录

> 实施日期：2026-04-25
> 服务器：root@8.138.237.225
> 工具：Let's Encrypt + certbot + systemd timer

## 一、当前状态总览

### 在用证书（自动续期范围内）

| 域名 | 到期日 | 用途 |
|------|--------|------|
| admin.video.hkting.com | 2026-06-28 | 后台 |
| card.hkting.com | 2026-07-08 | 小程序 H5 |
| cms.hkting.com | 2026-06-08 | 主后台 |
| **docs.cms.hkting.com** | **2026-07-24** | **使用手册（本次新建）** |
| h5.cms.hkting.com | 2026-07-12 | 联盟小程序预览 |
| huiclaw.hkting.com | 2026-07-09 | — |
| lottery.hkting.com | 2026-06-08 | 抽奖 |
| m.video.hkting.com | 2026-06-22 | 视频移动端 |
| vapi.hkting.com | 2026-06-16 | 视频 API |
| video.hkting.com | 2026-06-16 | 视频主站 |

### 已删除的失效证书

| 域名 | 删除原因 |
|------|---------|
| hkting.com | DNS 已迁出本服务器（→ 216.198.79.1）；证书 2026-02-08 过期且无法续期 |
| www.hkting.com | DNS 已迁出本服务器（→ 216.198.79.65）；证书 2026-02-08 过期且无法续期 |

伴随处理：`/etc/nginx/conf.d/home_443.conf` 引用了已删除的证书路径，重命名为 `home_443.conf.disabled` 以免 nginx 加载失败。

## 二、自动续期机制

### 执行链路

```
systemd: certbot-renew.timer        每 12h 触发一次（OnCalendar=*-*-* 00/12:00:00）
   └─→ certbot-renew.service        ExecStart=/usr/bin/certbot renew
         ├─→ 检查每个证书是否 < 30 天到期
         ├─→ 到期则发起 HTTP-01 challenge 申请新证书
         └─→ 续期成功后触发 deploy-hook：
             /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
                 └─→ nginx -t && nginx -s reload
```

### 关键文件

| 路径 | 作用 |
|------|------|
| `/usr/lib/systemd/system/certbot-renew.timer` | systemd 定时器（系统包自带） |
| `/usr/lib/systemd/system/certbot-renew.service` | 实际执行的 service |
| `/etc/letsencrypt/renewal/<domain>.conf` | 每个证书的续期参数 |
| `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` | **本次新增**：续期成功后 reload nginx |
| `/var/log/letsencrypt/letsencrypt.log` | 续期日志 |

### deploy-hook 内容

```bash
#!/bin/bash
nginx -t && nginx -s reload
```

每次 *任何* 证书续期成功都会跑这个脚本，让 nginx 加载新证书。**这是本次实施的核心补强** —— 之前没有 hook，证书续期后 nginx 仍用旧证书，得人工 reload。

## 三、本仓库提供的工具

`docs/deploy/cert-manage.sh` —— 通过 SSH 远程操作服务器证书。

```bash
./cert-manage.sh status              # 查看所有证书 + 自动续期 timer 状态
./cert-manage.sh renew-dry           # 模拟续期（不消耗速率）
./cert-manage.sh renew               # 实际续期（< 30 天到期才会真续）
./cert-manage.sh issue <domain>      # 为新域名申请并部署证书
./cert-manage.sh setup               # 校验/安装 deploy-hook
./cert-manage.sh logs [n]            # 查看 certbot 日志
```

> 所有命令本质是 SSH 到 8.138.237.225 调 certbot，不用先登录服务器。

### 申请新域名证书的标准流程

```bash
# 1. 在 DNS 服务商加 A 记录指向 8.138.237.225
# 2. 写一份 http-only 的 nginx 配置（参考 nginx-docs.conf）
# 3. nginx -s reload 让 80 端口能响应该域名
# 4. 申请并自动安装：
./cert-manage.sh issue your-domain.example.com
```

certbot --nginx 插件会自动改写 nginx 配置加上 SSL + HTTP→HTTPS 跳转。

## 四、本次新增/修改的文件

```
docs/deploy/
├── cert-manage.sh              [新增] 证书管理脚本（SSH 远程操作）
├── nginx-docs.conf             [新增] docs.cms.hkting.com 备查 nginx 配置
├── deploy-frontend.sh          [改] 加入 wiki-docs 项目；rsync 缺失时 fallback 到 scp
└── CERT_AUTO_RENEWAL.md        [新增] 本文档
```

服务器侧：

```
/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh   [新增] 续期 reload hook
/etc/nginx/conf.d/docs.cms.hkting.com.conf              [新增] HTTPS 站点
/etc/nginx/html/docs/                                   [新增] 静态产物
/etc/nginx/conf.d/home_443.conf.disabled                [禁用] 引用已删除证书的旧配置
```

## 五、定期检查建议

| 频率 | 操作 |
|------|------|
| 每月 | `./cert-manage.sh status` 看一眼到期日和 timer 是否还在 enabled |
| 每季度 | `./cert-manage.sh renew-dry` 跑一次，确认所有证书 challenge 都能通过 |
| 出现 nginx 配置变更后 | `./cert-manage.sh renew-dry` 验证不会破坏续期链路 |
| 域名变更 / DNS 切换 | 立即用 `certbot delete --cert-name X` 清理失效证书 |

## 六、踩过的坑

1. **删除证书后 nginx 起不来** —— 删 cert 不会自动改 nginx 配置；要么先改配置再删，要么删后立即把引用旧路径的 server block 注释/禁用，否则下次 nginx -s reload 就挂。**本次的处理**：把 `home_443.conf` 重命名为 `.disabled`。

2. **certbot dry-run 一损俱损** —— 任何一个 server block 引用不存在的证书路径，会让整个 `nginx -t` 失败，从而所有证书的模拟续期都报错。修一个救一片。

3. **DNS 不再指向本机的域名** —— 证书续期会永远失败；不主动删除会导致 timer 一直 status=failed，干扰监控。

4. **`/root/.bashrc` 里 pyenv 报错刷屏** —— 不影响功能但很吵；本仓库脚本输出全部 `grep -v pyenv` 过滤。

5. **certbot 互锁** —— certbot 本身保证同时只跑一个；如果上一次 dry-run 还没出，新调用会报 "Another instance of Certbot is already running"，等几十秒再试。
