#!/usr/bin/env bash
# Installs or updates the Mysl realtime server on an Ubuntu machine. Run as root:
#   curl -fsSL https://raw.githubusercontent.com/lopsserg02-collab/mysl/main/deploy/realtime/install.sh | bash
# The first run asks for the database address and the realtime secret (typed, never shown) and keeps them
# in /opt/mysl/deploy/realtime/.env. Later runs only update the code and restart.
set -euo pipefail
DIR=/opt/mysl
REPO=https://github.com/lopsserg02-collab/mysl.git

[ "$(id -u)" = 0 ] || { echo "Запустите от root (или через sudo)."; exit 1; }

if ! command -v git >/dev/null || ! command -v curl >/dev/null; then
  apt-get update -qq && apt-get install -y -qq git curl
fi
if ! command -v docker >/dev/null; then
  echo "Ставлю Docker…"
  curl -fsSL https://get.docker.com | sh
fi

if [ -d "$DIR/.git" ]; then git -C "$DIR" pull -q --ff-only; else git clone -q --depth 1 "$REPO" "$DIR"; fi
cd "$DIR/deploy/realtime"

if [ ! -f .env ]; then
  for p in 80 443; do
    if ss -ltnH "sport = :$p" | grep -q .; then
      echo "Порт $p уже занят другой программой. Напишите об этом в чат — подберу другой вариант."; exit 1
    fi
  done
  ip=$(curl -4 -fsS https://api.ipify.org)
  host="${ip//./-}.sslip.io"
  echo
  echo "Скопируйте значения из Render (mysl-realtime → Environment). Набранное не отображается — это нормально."
  read -rsp "DATABASE_URL: " db </dev/tty; echo
  read -rsp "REALTIME_SECRET: " secret </dev/tty; echo
  [ -n "$db" ] && [ -n "$secret" ] || { echo "Оба значения нужны. Запустите команду ещё раз."; exit 1; }
  umask 077
  printf 'MYSL_HOST=%s\nDATABASE_URL=%s\nREALTIME_SECRET=%s\n' "$host" "$db" "$secret" > .env
fi

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi

docker compose up -d --build
host=$(grep '^MYSL_HOST=' .env | cut -d= -f2)
echo
echo "Готово. Адрес сервера досок: wss://$host"
echo "Скопируйте эту строку в чат."
