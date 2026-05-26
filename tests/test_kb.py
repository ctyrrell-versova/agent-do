#!/usr/bin/env python3
"""Focused tests for the agent-kb Palantir HTTP client."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import textwrap
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


def run_agent(args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(ROOT / "agent-do"), *args],
        cwd=ROOT,
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )


def configure_fake_curl(tmpdir: Path) -> dict[str, str]:
    fake_bin = tmpdir / "bin"
    fake_bin.mkdir(parents=True)
    write_executable(
        fake_bin / "curl",
        textwrap.dedent(
            """\
            #!/usr/bin/env python3
            import json
            import os
            import sys

            if os.environ.get("FAKE_CURL_FAIL") == "1":
                raise SystemExit(7)

            args = sys.argv[1:]
            out_path = None
            method = "GET"
            data = ""
            headers = []
            url = ""
            i = 0
            while i < len(args):
                arg = args[i]
                if arg == "-o":
                    out_path = args[i + 1]
                    i += 2
                elif arg == "-X":
                    method = args[i + 1]
                    i += 2
                elif arg == "-d":
                    data = args[i + 1]
                    i += 2
                elif arg == "-H":
                    headers.append(args[i + 1])
                    i += 2
                elif arg.startswith("http"):
                    url = arg
                    i += 1
                elif arg in {"-sS", "-s"}:
                    i += 1
                elif arg == "-w":
                    i += 2
                else:
                    i += 1

            status = "404"
            body = {"error": "not found"}
            if url.endswith("/health"):
                status = os.environ.get("FAKE_HEALTH_STATUS", "200")
                body = {"status": "ok"} if status == "200" else {"error": "unhealthy"}
            elif url.endswith("/kb") and method == "POST":
                auth = next((h for h in headers if h.lower().startswith("authorization:")), "")
                if auth != "Authorization: Bearer good-token":
                    status = "401"
                    body = {"error": "unauthorized"}
                else:
                    try:
                        payload = json.loads(data)
                    except json.JSONDecodeError as exc:
                        status = "422"
                        body = {"error": str(exc)}
                    else:
                        question = payload.get("question", "")
                        if question == "":
                            status = "400"
                            body = {"error": "missing or empty question field"}
                        else:
                            status = "200"
                            body = {
                                "question": question,
                                "answer": "fake answer",
                                "sources": [],
                                "freshness": {"latestCommitAge": None},
                                "retrievalSimilarity": {"top1": 0, "top10Mean": 0},
                                "noContext": True,
                            }

            if os.environ.get("CAPTURE_CURL_BODY"):
                with open(os.environ["CAPTURE_CURL_BODY"], "w", encoding="utf-8") as fh:
                    fh.write(data)
            if out_path:
                with open(out_path, "w", encoding="utf-8") as fh:
                    json.dump(body, fh)
                sys.stdout.write(status)
            else:
                sys.stdout.write(json.dumps(body))
                sys.stdout.write("\\n")
                sys.stdout.write(status)
            """
        ),
    )
    return {
        "PATH": f"{fake_bin}{os.pathsep}{os.environ.get('PATH', '')}",
        "PALANTIR_URL": "https://palantir.test/",
        "AGENT_DO_HOME": str(tmpdir / "home"),
        "AGENT_DO_TELEMETRY_SUPPRESS": "1",
    }


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        env = os.environ.copy()
        env.update(configure_fake_curl(tmpdir))
        env["PALANTIR_KB_TOKEN"] = "good-token"

        ask = run_agent(["kb", "ask", r"where is C:\\tmp?", "--json"], env)
        require(ask.returncode == 0, f"ask failed: {ask.stderr}")
        ask_payload = json.loads(ask.stdout)
        require(ask_payload["success"] is True, f"ask should use json_result: {ask_payload}")
        require(ask_payload["result"]["question"] == r"where is C:\\tmp?", f"question did not round-trip: {ask_payload}")

        dash_question = run_agent(["kb", "ask", r"-n C:\\tmp", "--json"], env)
        require(dash_question.returncode == 0, f"dash-prefixed ask failed: {dash_question.stderr}")
        dash_payload = json.loads(dash_question.stdout)
        require(dash_payload["result"]["question"] == r"-n C:\\tmp", f"dash question did not round-trip: {dash_payload}")

        env_404 = env.copy()
        env_404["FAKE_HEALTH_STATUS"] = "404"
        health = run_agent(["kb", "health"], env_404)
        require(health.returncode != 0, "health should fail on non-200 status")
        require("unhealthy (HTTP 404)" in health.stdout, f"unexpected health output: {health.stdout}")

        health_json = run_agent(["kb", "health", "--json"], env)
        require(health_json.returncode == 0, f"health --json failed: {health_json.stderr}")
        health_payload = json.loads(health_json.stdout)
        require(health_payload["success"] is True, f"unexpected health json: {health_payload}")
        require(health_payload["result"]["ok"] is True, f"unexpected health json: {health_payload}")
        require(health_payload["result"]["palantir"]["status"] == "ok", f"unexpected health json: {health_payload}")

        snapshot = run_agent(["kb", "snapshot", "--json"], env)
        require(snapshot.returncode == 0, f"snapshot should pass with valid auth: {snapshot.stderr}")
        snapshot_payload = json.loads(snapshot.stdout)
        require(snapshot_payload["auth_status"] == "ok", f"unexpected snapshot: {snapshot_payload}")
        require(snapshot_payload["api_reachable"] is True, f"unexpected snapshot: {snapshot_payload}")

        bad_env = env.copy()
        bad_env["PALANTIR_KB_TOKEN"] = "bad-token"
        bad_snapshot = run_agent(["kb", "snapshot", "--json"], bad_env)
        require(bad_snapshot.returncode != 0, "snapshot should fail with invalid auth")
        bad_payload = json.loads(bad_snapshot.stdout)
        require(bad_payload["auth_status"] == "invalid", f"unexpected bad snapshot: {bad_payload}")

    print("kb tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
