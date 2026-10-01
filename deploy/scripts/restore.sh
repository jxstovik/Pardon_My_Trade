#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: deploy/scripts/restore.sh /path/to/pmt-backup.sqlite" >&2
  exit 2
fi
backup=$(cd "$(dirname -- "$1")" && pwd)/$(basename -- "$1")
if [ ! -f "$backup" ] || [ -L "$backup" ]; then
  echo "Backup must be a regular file, not a symlink: $backup" >&2
  exit 2
fi
compose_file=${PMT_COMPOSE_FILE:-docker-compose.yml}
backup_dir=$(cd "$(dirname "$backup")" && pwd)
backup_name=$(basename "$backup")

docker compose -f "$compose_file" stop pmt
running=$(docker compose -f "$compose_file" ps --status running -q pmt)
if [ -n "$running" ]; then
  echo "A PMT container is still running; stop all PMT web and MCP processes before restore." >&2
  exit 1
fi
docker compose -f "$compose_file" run --rm --no-deps \
  -v "$backup_dir:/restore:ro" pmt \
  node deploy/scripts/restore.mjs "/restore/$backup_name"
printf 'Restore complete. Start the service with: docker compose -f %s up -d\n' "$compose_file"
