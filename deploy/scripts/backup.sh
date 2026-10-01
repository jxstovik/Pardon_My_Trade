#!/usr/bin/env sh
set -eu

compose_file=${PMT_COMPOSE_FILE:-docker-compose.yml}
backup_dir=${PMT_BACKUP_DIR:-./backups}
mkdir -p "$backup_dir"
backup_dir=$(cd "$backup_dir" && pwd)
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
name="pmt-${timestamp}.sqlite"
docker compose -f "$compose_file" run --rm --no-deps \
  -v "$backup_dir:/backup:rw" pmt \
  node deploy/scripts/backup.mjs "/backup/$name"
printf 'Backup saved to %s/%s\n' "$backup_dir" "$name"
