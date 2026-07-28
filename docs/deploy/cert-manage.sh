#!/bin/bash
# 证书管理脚本 - BradyAICMS
# 通过 SSH 操作服务器上的 Let's Encrypt 证书
#
# 子命令：
#   status              查看所有证书到期日
#   renew               立即跑一次续期（生产环境）
#   renew-dry           模拟续期，不实际申请
#   issue <domain>      为新域名申请证书（HTTP-01 + nginx 插件）
#   setup               安装/校验自动续期机制（systemd timer + nginx reload hook）
#   logs                查看续期历史日志
#
# 服务器 (8.138.237.225) 上的状态参考：
#   - certbot 已安装在 /usr/bin/certbot
#   - systemd timer `certbot-renew.timer` 已启用（每 12 小时一次）
#   - 证书目录 /etc/letsencrypt/live/

set -e

SERVER="root@8.138.237.225"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SSH_KEY="$SCRIPT_DIR/hkt.pem"
ADMIN_EMAIL="bradyliuy@gmail.com"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()  { echo -e "${BLUE}[STEP]${NC} $1"; }

if [ ! -f "$SSH_KEY" ]; then
    log_error "找不到 SSH 密钥: $SSH_KEY"
    exit 1
fi

remote() {
    ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SERVER" "$@"
}

show_usage() {
    cat <<'EOF'
用法: ./cert-manage.sh <subcommand> [args]

子命令:
    status              查看所有证书到期日 + 自动续期状态
    renew               立即跑一次续期（如有到期临近的）
    renew-dry           模拟续期（不实际申请）
    issue <domain>      为新域名申请证书（需要域名已解析到本服务器）
    setup               校验/安装自动续期 hook（nginx reload）
    logs [n]            查看最近 n 行 certbot 日志（默认 50）

示例:
    ./cert-manage.sh status
    ./cert-manage.sh issue docs.cms.hkting.com
    ./cert-manage.sh setup
    ./cert-manage.sh renew

注意:
    - 申请新证书前，请确保 DNS A 记录已解析到 8.138.237.225
    - Let's Encrypt 速率限制：同一域名每周最多 5 个证书
    - 失败时优先用 renew-dry 排查，不消耗速率配额
EOF
}

cmd_status() {
    log_step "证书清单"
    remote 'certbot certificates 2>&1 | grep -E "^Certificate Name:|Domains:|Expiry Date:|VALID:|INVALID:" | sed "s/^  //"'

    echo
    log_step "自动续期定时器"
    remote 'systemctl list-timers --all 2>/dev/null | grep -E "NEXT|certbot" | head -5'

    echo
    log_step "上次自动续期结果"
    remote 'systemctl status certbot-renew.service 2>&1 | grep -E "Active:|Process:" | head -3'

    echo
    log_step "deploy-hook（续期成功后是否自动 reload nginx）"
    remote 'ls -la /etc/letsencrypt/renewal-hooks/deploy/ 2>/dev/null || echo "  (目录为空 - 未配置 reload hook)"'
}

cmd_renew_dry() {
    log_step "模拟续期（dry-run，不会实际申请证书）"
    remote 'certbot renew --dry-run 2>&1 | tail -30'
}

cmd_renew() {
    log_step "立即跑一次续期"
    log_warn "仅会续期距到期 < 30 天的证书；其余跳过"
    remote 'certbot renew --noninteractive --deploy-hook "nginx -s reload" 2>&1 | tail -30'

    echo
    log_step "续期后状态"
    remote 'certbot certificates 2>&1 | grep -E "Certificate Name:|Expiry Date:"'
}

cmd_issue() {
    local domain="$1"
    if [ -z "$domain" ]; then
        log_error "用法: $0 issue <domain>"
        exit 1
    fi

    log_step "为 $domain 申请证书"
    log_info "前置检查：DNS 是否解析到本服务器"

    local resolved server_ip
    resolved=$(remote "dig +short $domain A | tail -1" 2>/dev/null)
    server_ip=$(remote 'curl -s ifconfig.me' 2>/dev/null || echo "8.138.237.225")

    if [ "$resolved" != "$server_ip" ]; then
        log_warn "DNS 解析: $domain → $resolved，但服务器 IP 是 $server_ip"
        log_warn "继续会导致 HTTP-01 challenge 失败。"
        read -p "仍要继续吗? [y/N] " confirm
        [ "$confirm" != "y" ] && exit 1
    else
        log_info "DNS 解析正确：$domain → $resolved"
    fi

    log_step "通过 certbot --nginx 插件申请并安装证书"
    remote "certbot --nginx -d '$domain' --non-interactive --agree-tos -m '$ADMIN_EMAIL' --redirect 2>&1" | tail -25

    echo
    log_info "如果成功：nginx 配置已自动加上 SSL，访问 https://$domain 即可"
    log_info "证书会自动加入 certbot-renew.timer 的续期范围"
}

cmd_setup() {
    log_step "1/3 校验 systemd 定时器"
    if remote 'systemctl is-enabled certbot-renew.timer 2>&1 | grep -qE "enabled|static"'; then
        log_info "  certbot-renew.timer 已启用"
    else
        log_warn "  certbot-renew.timer 未启用，正在启用..."
        remote 'systemctl enable --now certbot-renew.timer'
    fi
    remote 'systemctl list-timers --all 2>/dev/null | grep certbot-renew | head -1'

    echo
    log_step "2/3 安装 deploy-hook（续期成功后自动 reload nginx）"
    remote '
        mkdir -p /etc/letsencrypt/renewal-hooks/deploy
        cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'\''HOOK'\''
#!/bin/bash
# Auto-installed by cert-manage.sh
# 续期成功后让 nginx 加载新证书
nginx -t && nginx -s reload
HOOK
        chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
        ls -la /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
    '

    echo
    log_step "3/3 模拟续期，验证 hook 链路"
    remote 'certbot renew --dry-run 2>&1 | tail -10'

    echo
    log_info "✓ 自动续期已就绪：每 12h 自动检查；< 30 天自动续期；成功后自动 reload nginx"
    log_info "  下次定时执行：$(remote 'systemctl list-timers certbot-renew.timer --no-pager 2>/dev/null | awk "NR==2 {print \$1, \$2, \$3}"')"
}

cmd_logs() {
    local n="${1:-50}"
    log_step "最近 $n 行 certbot 日志"
    remote "tail -n $n /var/log/letsencrypt/letsencrypt.log 2>&1"
}

case "${1:-}" in
    status)     cmd_status ;;
    renew)      cmd_renew ;;
    renew-dry)  cmd_renew_dry ;;
    issue)      shift; cmd_issue "$@" ;;
    setup)      cmd_setup ;;
    logs)       shift; cmd_logs "$@" ;;
    -h|--help|help|"") show_usage ;;
    *)
        log_error "未知子命令: $1"
        show_usage
        exit 1
        ;;
esac
