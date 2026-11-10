import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

Import("env")

project = Path(env.subst("$PROJECT_DIR"))


def git(*args):
    result = subprocess.run(
        ["git", *args], cwd=project, check=True, capture_output=True, text=True
    )
    return result.stdout.strip()


revision = git("rev-parse", "--short=12", "HEAD")
dirty = bool(git(
    "status", "--porcelain", "--untracked-files=normal", "--", ".", ":(exclude).pio"
))
built_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
generated = Path(env.subst("$BUILD_DIR")) / "generated"
generated.mkdir(parents=True, exist_ok=True)
(generated / "firmware_build.h").write_text(
    "#pragma once\n"
    f"#define TIPIN_GIT_REVISION {json.dumps(revision)}\n"
    f"#define TIPIN_GIT_DIRTY {'true' if dirty else 'false'}\n"
    f"#define TIPIN_BUILD_TIMESTAMP {json.dumps(built_at)}\n",
    encoding="ascii",
)
env.Append(CPPPATH=[str(generated)])
print(f"TipIn firmware build: {revision}{'-dirty' if dirty else ''} at {built_at}")
