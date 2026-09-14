#!/usr/bin/env python3
"""agent-render: db show / db connect-info / kv connect-info must mask passwords
unless --reveal is passed, and must honour --json.

Runs the real cmd_* functions against a stubbed render_request so no network
or API key is needed.
"""

from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

PG_INFO = '{"id":"dpg-test","name":"test-db","status":"available","plan":"basic","region":"oregon","version":"16","createdAt":"2026-01-01T00:00:00Z"}'
PG_CONN = (
    '{"externalConnectionString":"postgresql://app:S3cr3tPg@host.render.com:5432/db",'
    '"internalConnectionString":"postgresql://app:S3cr3tPg@dpg-test-a/db",'
    '"password":"S3cr3tPg",'
    '"psqlCommand":"PGPASSWORD=S3cr3tPg psql -h host.render.com -p 5432 -U app db"}'
)
KV_CONN = (
    '{"cliCommand":" REDISCLI_AUTH=S3cr3tKv valkey-cli --user red-test -h kv.render.com -p 6379 --tls",'
    '"externalConnectionString":"rediss://red-test:S3cr3tKv@kv.render.com:6379",'
    '"internalConnectionString":"redis://red-test:6379"}'
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def run(cmd: str, render_json: str = "0") -> subprocess.CompletedProcess[str]:
    script = f"""
set -euo pipefail
source <(awk '/^# --- Main ---/{{exit}} {{print}}' "{ROOT / 'tools/agent-render'}")
resolve_postgres() {{ echo "dpg-test"; }}
resolve_kv() {{ echo "red-test"; }}
render_request() {{
  case "$2" in
    /postgres/dpg-test) printf '%s\\n' '{PG_INFO}' ;;
    /postgres/dpg-test/connection-info) printf '%s\\n' '{PG_CONN}' ;;
    /key-value/red-test/connection-info) printf '%s\\n' '{KV_CONN}' ;;
    *) echo "unexpected endpoint: $2" >&2; return 1 ;;
  esac
}}
RENDER_JSON={render_json}
{cmd}
"""
    return subprocess.run(["bash", "-lc", script], cwd=ROOT, text=True, capture_output=True, check=False)


def main() -> int:
    # db connect-info: masked by default, every line
    r = run("cmd_db_connect_info test-db")
    require(r.returncode == 0, f"connect-info failed: {r.stderr}")
    require("S3cr3tPg" not in r.stdout, f"password leaked in connect-info: {r.stdout}")
    require(r.stdout.count("***") == 3, f"expected 3 masked sites: {r.stdout}")
    require("PGPASSWORD=***" in r.stdout, f"PGPASSWORD not masked: {r.stdout}")

    # db connect-info --reveal: raw values
    r = run("cmd_db_connect_info test-db --reveal")
    require(r.returncode == 0, f"connect-info --reveal failed: {r.stderr}")
    require(r.stdout.count("S3cr3tPg") == 3, f"--reveal did not restore values: {r.stdout}")
    require("***" not in r.stdout, f"--reveal still masked: {r.stdout}")

    # db connect-info --json: JSON, masked including the bare password field
    r = run("cmd_db_connect_info test-db", render_json="1")
    require(r.returncode == 0, f"connect-info --json failed: {r.stderr}")
    require(r.stdout.lstrip().startswith("{"), f"--json did not emit JSON: {r.stdout}")
    require("S3cr3tPg" not in r.stdout, f"password leaked in --json: {r.stdout}")
    require('"password":"***"' in r.stdout, f"bare password field not masked: {r.stdout}")

    # db show: masked text; --json wraps both objects
    r = run("cmd_db show test-db")
    require(r.returncode == 0, f"db show failed: {r.stderr}")
    require("S3cr3tPg" not in r.stdout, f"password leaked in db show: {r.stdout}")
    require("Name:     test-db" in r.stdout, f"db show lost non-secret fields: {r.stdout}")
    r = run("cmd_db show test-db", render_json="1")
    require(r.returncode == 0, f"db show --json failed: {r.stderr}")
    require('"postgres"' in r.stdout and '"connectionInfo"' in r.stdout, f"db show --json shape: {r.stdout}")
    require("S3cr3tPg" not in r.stdout, f"password leaked in db show --json: {r.stdout}")
    r = run("cmd_db show test-db --reveal", render_json="1")
    require("S3cr3tPg" in r.stdout, f"db show --json --reveal did not reveal: {r.stdout}")

    # kv connect-info: REDISCLI_AUTH and rediss:// userinfo masked
    r = run("cmd_kv connect-info test-kv")
    require(r.returncode == 0, f"kv connect-info failed: {r.stderr}")
    require("S3cr3tKv" not in r.stdout, f"password leaked in kv connect-info: {r.stdout}")
    require("REDISCLI_AUTH=***" in r.stdout, f"REDISCLI_AUTH not masked: {r.stdout}")
    require("rediss://red-test:***@" in r.stdout, f"rediss userinfo not masked: {r.stdout}")
    r = run("cmd_kv connect-info test-kv --reveal")
    require(r.stdout.count("S3cr3tKv") == 2, f"kv --reveal did not restore: {r.stdout}")

    print("render db secrets tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
