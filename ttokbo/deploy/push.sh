#!/usr/bin/env bash
# 이 PC에서 빌드해 서버(당직봇과 공유하는 dangjik-bot)에 올린다. 서버에서는 빌드하지 않는다.
#   bash deploy/push.sh
# 서버 쪽 준비(계정·Node·DB·nginx·서비스)는 deploy/README.md 참고.
set -euo pipefail

HOST="${TTOKBO_HOST:-ncloud@27.96.150.212}"
KEY="${TTOKBO_SSH_KEY:-$HOME/.ssh/id_ed25519}"
SSH=(ssh -o BatchMode=yes -o IdentitiesOnly=yes -i "$KEY")
SCP=(scp -q -o BatchMode=yes -o IdentitiesOnly=yes -i "$KEY")

cd "$(dirname "$0")/.."
REL="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
[ -z "$(git status --porcelain)" ] || REL="$REL-dirty"

echo "== 빌드"
npm run build
S=.next/standalone
cp -r public "$S/"
cp -r .next/static "$S/.next/"

# Windows 빌드는 심볼릭 링크를 이 PC의 절대 경로로 만든다 → 목록으로 남기고 서버에서 상대 링크로 다시 만든다
: > "$S/links.txt"
while IFS= read -r link; do
  target="$(readlink "$link")"
  echo "${link#"$S"/} ${target#*/.next/standalone/}" >> "$S/links.txt"
  rm "$link"
done < <(find "$S" -type l)

echo "== 묶기·올리기 ($REL)"
TGZ="$(mktemp -d)/ttokbo-$REL.tgz"
tar -czf "$TGZ" -C "$S" .
"${SCP[@]}" "$TGZ" "$HOST:/tmp/ttokbo-$REL.tgz"

echo "== 서버에 풀고 재시작"
"${SSH[@]}" "$HOST" "sudo bash -s" <<EOF
set -euo pipefail
R=/opt/ttokbo/releases/$REL
mkdir -p "\$R"
tar -xzf /tmp/ttokbo-$REL.tgz -C "\$R" && rm /tmp/ttokbo-$REL.tgz
while read -r link target; do
  [ -n "\$link" ] || continue
  mkdir -p "\$(dirname "\$R/\$link")"
  ln -sr "\$R/\$target" "\$R/\$link"
done < "\$R/links.txt"
chown -R ttokbo:ttokbo "\$R"
ln -sfn "\$R" /opt/ttokbo/current
systemctl restart ttokbo
for _ in \$(seq 1 30); do
  if curl -fsS -o /dev/null http://127.0.0.1:3100/api/auth/departments; then
    echo "배포 완료: $REL"
    # 이전 배포는 3개까지만 남긴다 (되돌리기용)
    ls -1dt /opt/ttokbo/releases/* | tail -n +4 | xargs -r rm -rf
    exit 0
  fi
  sleep 2
done
echo "서버가 응답하지 않습니다: journalctl -u ttokbo -n 50" >&2
exit 1
EOF
