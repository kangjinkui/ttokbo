#!/usr/bin/env bash
# 최신 main을 받아 빌드하고 재시작한다. 서버에서 root로: sudo bash /opt/ttokbo/ttokbo/deploy/deploy.sh
set -euo pipefail

REPO_DIR=/opt/ttokbo
APP_DIR=$REPO_DIR/ttokbo
ENV_FILE=/etc/ttokbo/ttokbo.env

as_app() { sudo -u ttokbo -H bash -c "set -a; . $ENV_FILE; set +a; cd $APP_DIR; $1"; }

sudo -u ttokbo -H git -C "$REPO_DIR" pull --ff-only
as_app "npm ci --no-audit --no-fund"
as_app "npm run build"
systemctl restart ttokbo

# 뜰 때까지 확인 (DB 연결·마이그레이션까지 거치는 API로)
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/api/auth/departments; then
    echo "배포 완료: $(sudo -u ttokbo git -C "$REPO_DIR" log --oneline -1)"
    exit 0
  fi
  sleep 2
done
echo "서버가 응답하지 않습니다. 'journalctl -u ttokbo -n 50'으로 확인하세요." >&2
exit 1
