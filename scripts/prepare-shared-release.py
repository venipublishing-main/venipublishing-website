"""Materialize the reviewed ledger from Git blobs. No Supabase connection."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory

WEBSITE = Path(__file__).resolve().parents[1]
WEBSITE_REV = "065a31be962533576a52016dc9ac8bee6535e375"
ARCANA_REV = "ae1c4929ce8d8aaa954eacfe9b4494bfb2924301"
ARCANA_SQL = "20260903072229_arcana_stage3_pilot_foundation.sql"
FOUNDATION = "20260903_001_veni_account_foundation.sql"
LEDGER = "supabase/migrations/"
RESERVE_REV = "756e25a8919eae41964ece4e836388fa0dbd3a8a"
PERFORMANCE_REV = "e4f42b6ab6dd94effa94125ccb4e560d846991ca"
REPORT = "docs/architecture/shared-staging-readiness-20261120.md"


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("arcana_checkout", type=Path)
    parser.add_argument("new_directory", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--fresh-fixture", action="store_true",
                        help="Include the pre-ledger bootstrap under a local-only version")
    mode.add_argument("--review-package", type=Path, nargs=2, metavar=("RESERVE", "PERFORMANCE"),
                      help="Add pinned Worker source archives, Website changes and operator instructions")
    args = parser.parse_args()
    files = git(WEBSITE, "ls-tree", "-r", "--name-only", WEBSITE_REV, LEDGER).decode().splitlines()
    artifacts = {}
    for path in files:
        name = Path(path).name
        if name == FOUNDATION:
            if not args.fresh_fixture:
                continue
            name = "20260903070000_fixture_account_foundation.sql"
        artifacts[name] = git(WEBSITE, "show", WEBSITE_REV + ":" + path)
    artifacts[ARCANA_SQL] = git(args.arcana_checkout, "show", ARCANA_REV + ":" + LEDGER + ARCANA_SQL)
    assert len(artifacts) == (17 if args.fresh_fixture else 16)
    if args.review_package:
        reserve, performance = args.review_package
        artifacts = {"ledger/" + name: data for name, data in artifacts.items()}
        artifacts["reserve-source.zip"] = git(
            reserve, "archive", "--format=zip", RESERVE_REV, "--",
            "LICENSE", "app", "workers", "local", "tests/database/ci.mjs", "react-router.config.ts", "vite.config.ts",
            "tsconfig*.json", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "wrangler.jsonc",
        )
        artifacts["performance-source.zip"] = git(
            performance, "archive", "--format=zip", PERFORMANCE_REV, "--",
            "server", "src", "index.html", "vite.config.ts", "tsconfig.json", "package*.json",
            "deployment/classify-*.sql", "deployment/preflight.sql", "deployment/prepare-allowlist.mjs",
            "deployment/service-canary.mjs", "deployment/wrangler.staging.jsonc",
        )
        for path in ("account/settings/index.html", "assets/css/account-v2.css",
                     "assets/js/connected-applications.mjs", "assets/js/veni-oauth-clients.js",
                     "supabase/functions/delete-account/index.ts"):
            artifacts["website/" + path] = git(WEBSITE, "show", WEBSITE_REV + ":" + path)
        artifacts["release-and-rollback.md"] = git(WEBSITE, "show", "HEAD:" + REPORT)
        manifest = {
            "project": "droslqfcazwkwvqlbtsq",
            "website_application": WEBSITE_REV, "website_review": git(WEBSITE, "rev-parse", "HEAD").decode().strip(),
            "arcana_source": ARCANA_REV, "reserve_source": RESERVE_REV, "performance_source": PERFORMANCE_REV,
            "forward_sql": sorted(key for key in artifacts if key.startswith(("ledger/20261119", "ledger/20261120"))),
            "sha256": {key: hashlib.sha256(data).hexdigest() for key, data in sorted(artifacts.items())},
        }
        if len(manifest["forward_sql"]) != 5:
            raise ValueError("Expected five forward migrations")
        artifacts["manifest.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    destination = args.new_directory
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise FileExistsError(destination)
    with TemporaryDirectory(dir=destination.parent) as scratch:
        package = Path(scratch) / "package"
        for name, data in sorted(artifacts.items()):
            target = package / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            print(hashlib.sha256(data).hexdigest(), name)
        package.rename(destination)


if __name__ == "__main__":
    main()
