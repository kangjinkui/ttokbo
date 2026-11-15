#!/usr/bin/env bash
# 네이버 공공클라우드 Ubuntu 24.04 서버 최초 설치 (한 번만 실행).
#   sudo bash setup.sh <도메인>
# 도메인이 아직 없으면 <공인IP의 점을 하이픈으로>.sslip.io 를 쓸 수 있다 (예: 1-2-3-4.sslip.io).
# 다시 실행해도 이미 만든 DB·비밀값·설정 파일은 덮어쓰지 않는다.
set -euo pipefail

DOMAIN="${1:?사용법: sudo bash setup.sh <도메인>}"
REPO_URL="https://github.com/kangjinkui/ttokbo.git"
REPO_DIR=/opt/ttokbo
APP_DIR=$REPO_DIR/ttokbo
ENV_FILE=/etc/ttokbo/ttokbo.env

echo "== 기본 설정 (시간대, 스왑)"
timedatectl set-timezone Asia/Seoul
# 작은 서버에서 next build가 메모리 부족으로 죽지 않게 스왑 2GB
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== 패키지 (Node.js 24, PostgreSQL, Caddy)"
apt-get update
apt-get install -y ca-certificates curl gnupg git openssl postgresql debian-keyring debian-archive-keyring apt-transport-https
if ! node --version 2>/dev/null | grep -q '^v24'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

echo "== 실행 계정"
id ttokbo >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/ttokbo --shell /usr/sbin/nologin ttokbo

echo "== 데이터베이스"
DB_PASS=""
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='ttokbo'" | grep -q 1; then
  DB_PASS=$(openssl rand -hex 24)
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE ttokbo LOGIN PASSWORD '$DB_PASS'"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE ttokbo OWNER ttokbo"
fi

echo "== 환경변수 ($ENV_FILE)"
mkdir -p /etc/ttokbo
if [ ! -f "$ENV_FILE" ]; then
  [ -n "$DB_PASS" ] || { echo "DB 계정은 있는데 $ENV_FILE 이 없습니다. DATABASE_URL을 직접 넣어 주세요." >&2; exit 1; }
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
DATABASE_URL=postgresql://ttokbo:${DB_PASS}@127.0.0.1:5432/ttokbo
SESSION_SECRET=$(openssl rand -hex 32)
APP_BASE_URL=https://${DOMAIN}
# 운영: 개발용 로그인과 시험 계정을 끈다
ALLOW_DEV_LOGIN=false
SEED_DEMO=false
# 솔라피 키를 넣고 solapi로 바꾸면 실제 문자가 나간다 (그 전에는 서버 로그로만 출력)
MESSAGING_PROVIDER=console
SOLAPI_API_KEY=
SOLAPI_API_SECRET=
SOLAPI_SENDER=
MESSAGING_WEBHOOK_SECRET=$(openssl rand -hex 16)
# 이 번호로 가입하면 바로 관리자가 된다 (쉼표로 여러 개)
ADMIN_PHONES=
EOF
fi
chown root:ttokbo "$ENV_FILE" && chmod 640 "$ENV_FILE"

echo "== 소스"
if [ ! -d "$REPO_DIR/.git" ]; then git clone "$REPO_URL" "$REPO_DIR"; fi
chown -R ttokbo:ttokbo "$REPO_DIR"

echo "== 서비스 등록"
install -m 644 "$APP_DIR/deploy/ttokbo.service" /etc/systemd/system/ttokbo.service
sed "s/__DOMAIN__/${DOMAIN}/" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
install -m 755 "$APP_DIR/deploy/backup.sh" /etc/cron.daily/ttokbo-backup
systemctl daemon-reload
systemctl enable ttokbo caddy

echo "== 빌드·시작"
bash "$APP_DIR/deploy/deploy.sh"
systemctl reload caddy || systemctl restart caddy

echo "완료: https://${DOMAIN}"
echo "다음: $ENV_FILE 에 솔라피 키·ADMIN_PHONES를 넣고 'systemctl restart ttokbo'"
