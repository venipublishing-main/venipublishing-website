"""Materialize the reviewed ledger from Git blobs. No Supabase connection."""
import argparse
import hashlib
from pathlib import Path
import subprocess

WEBSITE = Path(__file__).resolve().parents[1]
WEBSITE_REV = "065a31be962533576a52016dc9ac8bee6535e375"
ARCANA_REV = "ae1c4929ce8d8aaa954eacfe9b4494bfb2924301"
ARCANA_SQL = "20260903072229_arcana_stage3_pilot_foundation.sql"
FOUNDATION = "20260903_001_veni_account_foundation.sql"
LEDGER = "supabase/migrations/"


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("arcana_checkout", type=Path)
    parser.add_argument("new_directory", type=Path)
    parser.add_argument("--fresh-fixture", action="store_true",
                        help="Include the pre-ledger bootstrap under a local-only version")
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
    args.new_directory.mkdir(parents=True, exist_ok=False)
    for name, data in sorted(artifacts.items()):
        (args.new_directory / name).write_bytes(data)
        print(hashlib.sha256(data).hexdigest(), name)


if __name__ == "__main__":
    main()
