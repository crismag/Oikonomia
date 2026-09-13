#!/usr/bin/env bash
# Oikonomia on Hostinger — the private data directory.
#
#   scripts/ops/hostinger-private.sh <domain> prepare
#   scripts/ops/hostinger-private.sh <domain> copy <old-database.db>
#   scripts/ops/hostinger-private.sh <domain> verify
#
# Run on the Hostinger account, over SSH. Layout it manages, with the least
# permissions that work (the application runs as this account):
#
#   ~/domains/<domain>/private/              500  dr-x------
#   └── oikonomia/                           500  dr-x------
#       ├── .env                             400  -r--------   OIKONOMIA_DB etc.
#       └── data/                            700  drwx------
#           ├── oikonomia.db (+ -wal, -shm)  600
#           └── artifacts/                   700
#
# prepare  Creates the layout and fixes permissions. Never writes a secret and
#          never overwrites an existing .env.
# copy     Copies an existing database (and its artifacts/) to the OIKONOMIA_DB
#          named in the private .env, via scripts/ops/copy-database.mjs: a
#          consistent snapshot, refused if the target is open or holds people.
#          Then: remove any OIKONOMIA_DB override in hPanel, and restart.
# verify   After the restart: the running application has the private database
#          open, it holds people, /healthz answers, permissions are right.
#
# Nothing here deletes data. Retiring the old database is left to a person.

set -euo pipefail
umask 077

domain="${1:?usage: $0 <domain> prepare|copy <old.db>|verify}"
command="${2:?usage: $0 <domain> prepare|copy <old.db>|verify}"

node="${NODE:-/opt/alt/alt-nodejs22/root/usr/bin/node}"
[ -x "$node" ] || node="$(command -v node)"

site="$HOME/domains/$domain"
private="$site/private"
app="$private/oikonomia"
envfile="$app/.env"
data="$app/data"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ -d "$site" ] || { echo "No $site — is the domain right?" >&2; exit 1; }

setting() { sed -n "s/^$1=//p" "$envfile" | tail -1 | sed 's/^"\(.*\)"$/\1/'; }

sqlite_module() {
  for candidate in \
    "$site/hbuilds/current/nodejs/.output/server/node_modules/better-sqlite3" \
    "$site/hbuilds/current/nodejs/node_modules/better-sqlite3" \
    "$here/../../node_modules/better-sqlite3"; do
    [ -d "$candidate" ] && { echo "$candidate"; return; }
  done
  echo "better-sqlite3 not found; deploy the application first." >&2
  exit 1
}

case "$command" in
  prepare)
    [ -d "$private" ] && chmod u+w "$private"
    [ -d "$app" ] && chmod u+w "$app"
    mkdir -p "$data"
    if [ ! -e "$envfile" ]; then
      cat > "$envfile" <<EOF
# Oikonomia — production settings for $domain. Keep chmod 400; never commit.
# A variable set in hPanel wins over this file. Restart the app after editing.
OIKONOMIA_URL=https://$domain
OIKONOMIA_DB=$data/oikonomia.db
EOF
      echo "wrote $envfile (no secrets; add them yourself)"
    fi
    chmod 700 "$data"
    [ -d "$data/artifacts" ] && find "$data/artifacts" -type d -exec chmod 700 {} + -o -type f -exec chmod 600 {} +
    find "$data" -maxdepth 1 -type f -name 'oikonomia.db*' -exec chmod 600 {} +
    chmod 400 "$envfile"
    chmod 500 "$app" "$private"
    ls -ld "$private" "$app" "$data"; ls -l "$envfile"
    ;;

  copy)
    old="${3:?usage: $0 <domain> copy <old-database.db>}"
    target="$(setting OIKONOMIA_DB)"
    [ -n "$target" ] || { echo "OIKONOMIA_DB is not set in $envfile" >&2; exit 1; }
    case "$target" in "$data"/*) ;; *) echo "OIKONOMIA_DB ($target) is not inside $data" >&2; exit 1 ;; esac
    "$node" "$here/copy-database.mjs" \
      --from "$old" --to "$target" --replace-empty \
      --sqlite "$(sqlite_module)" \
      --artifacts-from "$(dirname "$old")/artifacts" --artifacts-to "$data/artifacts"
    echo
    echo "Next: remove the OIKONOMIA_DB variable from hPanel (keep OIKONOMIA_ENV_FILE), restart the app, then run: $0 $domain verify"
    ;;

  verify)
    target="$(setting OIKONOMIA_DB)"
    status=0
    echo "== running application"
    found=0
    for pid in $(pgrep -u "$(id -u)" -f lsnode || true); do
      # A process with no database open is normal (Passenger keeps spares); grep's
      # "no match" must not end the script under `set -e -o pipefail`.
      open="$( { ls -l "/proc/$pid/fd" 2>/dev/null || true; } | { grep -oE '/[^ ]+\.db$' || true; } | sort -u | tr '\n' ' ')"
      if [ -n "$open" ]; then echo "  pid $pid has open: $open"; fi
      case " $open " in *" $target "*) found=1 ;; esac
    done
    if [ "$found" = 1 ]; then echo "  ok: the private database is the one in use"
    else echo "  NOT OK: no application process has $target open (restart it, or check hPanel for an OIKONOMIA_DB override)"; status=1; fi

    echo "== contents"
    "$node" -e '
      const D = require(process.argv[1]);
      const db = new D(process.argv[2], { readonly: true, fileMustExist: true });
      const n = (t) => db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n;
      console.log(`  people ${n("person")}, accounts ${n("account")}, schema ${db.prepare("SELECT max(version) AS v FROM schema_migrations").get().v}`);
      process.exit(n("person") > 0 ? 0 : 3);
    ' "$(sqlite_module)" "$target" || { echo "  NOT OK: the private database holds nobody — /setup would be open"; status=1; }

    echo "== health"
    url="$(setting OIKONOMIA_URL)"
    health="$(curl -fsS -m 15 "$url/healthz" || true)"
    echo "  $url/healthz → ${health:-no answer}"
    case "$health" in *'"ok":true'*) ;; *) status=1 ;; esac

    echo "== permissions"
    stat -c '  %a %n' "$private" "$app" "$envfile" "$data" "$data"/oikonomia.db* 2>/dev/null
    [ "$(stat -c %a "$envfile")" = 400 ] && [ "$(stat -c %a "$data")" = 700 ] || { echo "  NOT OK: run prepare"; status=1; }

    [ "$status" = 0 ] && echo "verified" || echo "verification FAILED"
    exit "$status"
    ;;

  *)
    echo "unknown command: $command" >&2
    exit 1
    ;;
esac
