#!/usr/bin/env python3
"""agent-gh create: opens a PR non-interactively via `gh pr create`, then reads
it back with `gh pr view --json` and reports url/number/head/base."""

from __future__ import annotations

import json
import os
import stat
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


FAKE_GH = """#!/usr/bin/env python3
import json, sys
log = open(sys.argv[1], "a"); argv = sys.argv[2:]
log.write(json.dumps({"argv": argv, "stdin": sys.stdin.read() if "-" in argv else ""}) + "\\n"); log.close()
if argv[:2] == ["pr", "create"]:
    print("Creating pull request for feat/x into main in o/r\\n")
    print("https://github.com/o/r/pull/42")
elif argv[:2] == ["pr", "view"]:
    print(json.dumps({"number": 42, "url": "https://github.com/o/r/pull/42", "title": "T", "state": "OPEN",
                      "isDraft": False, "headRefName": "feat/x", "baseRefName": "main"}))
else:
    sys.stderr.write("unexpected: " + " ".join(argv)); sys.exit(1)
"""


def main() -> int:
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        log = tmp / "calls.jsonl"
        wrapper = tmp / "gh"
        wrapper.write_text(f"#!/bin/sh\nexec python3 {tmp / 'fake_gh.py'} {log} \"$@\"\n")
        (tmp / "fake_gh.py").write_text(FAKE_GH)
        wrapper.chmod(wrapper.stat().st_mode | stat.S_IXUSR)
        env = dict(os.environ, AGENT_GH_BIN=str(wrapper))

        def run(*args: str, stdin: str | None = None) -> subprocess.CompletedProcess[str]:
            return subprocess.run([str(ROOT / "tools" / "agent-gh"), "create", *args], env=env, text=True,
                                  capture_output=True, input=stdin, check=False)

        # guards: never fall into gh's editor, push, or fork prompts
        r = run("--head", "feat/x", "--body", "b")
        require(r.returncode != 0 and "requires --title" in r.stderr, f"missing title not refused: {r.stderr}")
        r = run("--head", "feat/x", "--title", "T")
        require(r.returncode != 0 and "requires --body" in r.stderr, f"missing body not refused: {r.stderr}")
        r = run("--title", "T", "--body", "b")
        require(r.returncode != 0 and "--head" in r.stderr and "required" in r.stderr,
                f"missing head not refused: {r.stderr}")
        r = run("--head", "", "--title", "T", "--body", "b")
        require(r.returncode != 0 and "requires --head" in r.stderr,
                f"empty head not refused: {r.stderr}")
        require(not log.exists(), "gh must not be invoked when arguments are incomplete")

        # happy path with --json and stdin body
        r = run("--repo", "o/r", "--base", "main", "--head", "me:feat/x", "--title", "T", "--body-file", "-",
                "--reviewer", "erik", "--label", "fix", "--json", stdin="body from stdin")
        require(r.returncode == 0, f"create failed: {r.stderr}")
        out = json.loads(r.stdout)
        require(out["url"] == "https://github.com/o/r/pull/42" and out["number"] == 42, f"bad result: {out}")
        require(out["head"] == "feat/x" and out["base"] == "main" and out["draft"] is False, f"bad result: {out}")
        calls = [json.loads(line) for line in log.read_text().splitlines()]
        require(len(calls) == 2, f"expected create + view, got {calls}")
        create_argv = calls[0]["argv"]
        for needle in (["--repo", "o/r"], ["--base", "main"], ["--head", "me:feat/x"], ["--title", "T"],
                       ["--body-file", "-"], ["--reviewer", "erik"], ["--label", "fix"]):
            require(" ".join(needle) in " ".join(create_argv), f"missing {needle} in {create_argv}")
        require(calls[0]["stdin"] == "body from stdin", f"stdin body not forwarded: {calls[0]}")
        require("--web" not in create_argv and "--editor" not in create_argv, "must never go interactive")
        require(calls[1]["argv"][:3] == ["pr", "view", "https://github.com/o/r/pull/42"], f"view call: {calls[1]}")

        # text path
        log.unlink()
        r = run("--head", "feat/x", "--title", "T", "--body", "b", "--draft")
        require(r.returncode == 0, f"text create failed: {r.stderr}")
        require("Created https://github.com/o/r/pull/42  (#42, feat/x -> main)" in r.stdout, f"text output: {r.stdout}")
        require("--draft" in json.loads(log.read_text().splitlines()[0])["argv"], "--draft not forwarded")

    print("gh create tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
