#!/usr/bin/env bash
# 매일 DB 백업 (cron.daily). 14일치를 보관한다.
# 서버 안에만 있으므로 서버를 잃으면 백업도 사라진다. 중요해지면 Object Storage로 복사한다.
set -euo pipefail
DIR=/var/backups/ttokbo
mkdir -p "$DIR" && chmod 700 "$DIR"
sudo -u postgres pg_dump -Fc ttokbo > "$DIR/ttokbo-$(date +%F).dump"
find "$DIR" -name 'ttokbo-*.dump' -mtime +14 -delete
