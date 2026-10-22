"""Collect immutable public source snapshots for read-only benchmark research.

No downloaded code is executed and no provider configuration is touched.
"""
from __future__ import annotations

import concurrent.futures
import datetime as dt
import hashlib
import io
import json
import os
import zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".research-cache"
OUT = ROOT / "docs/research/evidence"
REPOS = {
    "magents": "abnegate/magents",
    "agent-intercom": "iambashar/agent-intercom",
    "agentmux": "adelost/agentmux",
    "orchestra": "theorchestradev/orchestra",
}
MAX_BYTES = 100 * 1024 * 1024


def download(url: str) -> bytes:
    with urlopen(Request(url, headers={"User-Agent": "inter-session-benchmark", "Accept": "application/vnd.github+json"}), timeout=45) as response:
        payload = response.read(MAX_BYTES + 1)
    if len(payload) > MAX_BYTES:
        raise ValueError("Download exceeds the research size limit")
    return payload


def api(path: str):
    return json.loads(download("https://api.github.com/" + path))


def collect(slug: str, repo: str):
    metadata = api("repos/" + repo)
    commit = api("repos/" + repo + "/commits/" + metadata["default_branch"])
    sha = commit["sha"]
    target = CACHE / slug / sha
    manifest_file = target / "snapshot.json"
    if manifest_file.is_file():
        return json.loads(manifest_file.read_text(encoding="utf-8"))
    archive_url = f"https://codeload.github.com/{repo}/zip/{sha}"
    archive_file = target / "source.zip"
    archive = archive_file.read_bytes() if archive_file.is_file() else download(archive_url)
    target.mkdir(parents=True, exist_ok=True)
    (target / "source.zip").write_bytes(archive)
    source = target / "source"
    source.mkdir(exist_ok=True)
    count = 0
    size = 0
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        for member in zipped.infolist():
            parts = Path(member.filename).parts
            if len(parts) < 2 or member.is_dir():
                continue
            relative = Path(*parts[1:])
            destination = (source / relative).resolve()
            if not destination.is_relative_to(source.resolve()):
                raise ValueError("Archive path escaped the source directory")
            size += member.file_size
            if size > 350 * 1024 * 1024:
                raise ValueError("Expanded source exceeds the research size limit")
            writable = Path("\\\\?\\" + str(destination)) if os.name == "nt" else destination
            writable.parent.mkdir(parents=True, exist_ok=True)
            writable.write_bytes(zipped.read(member))
            count += 1
    try:
        release = api("repos/" + repo + "/releases/latest")
        release_data = {"tag": release["tag_name"], "published_at": release.get("published_at"), "url": release["html_url"], "assets": [asset["name"] for asset in release.get("assets", [])]}
    except HTTPError as error:
        if error.code != 404:
            raise
        release_data = {"status": "no published latest release returned by GitHub API"}
    result = {
        "product": slug,
        "repository": repo,
        "sha": sha,
        "commit_url": commit["html_url"],
        "commit_date_utc": commit["commit"]["committer"]["date"],
        "retrieved_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "archive_url": archive_url,
        "archive_sha256": hashlib.sha256(archive).hexdigest(),
        "archive_bytes": len(archive),
        "file_count": count,
        "source_path": str(source),
        "default_branch": metadata["default_branch"],
        "archived": metadata["archived"],
        "license_metadata": (metadata.get("license") or {}).get("spdx_id"),
        "latest_release": release_data,
        "verification_level": "downloaded source, not installed or executed",
    }
    manifest_file.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(collect, slug, repo): slug for slug, repo in REPOS.items()}
        for future in concurrent.futures.as_completed(futures):
            try:
                row = future.result()
            except Exception as error:
                row = {"product": futures[future], "error": str(error), "verification_level": "collection failed"}
            rows.append(row)
            print(json.dumps({key: row[key] for key in ("product", "sha", "file_count", "error") if key in row}), flush=True)
    rows.sort(key=lambda row: row["product"])
    (OUT / "source-manifest.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if any("error" in row for row in rows):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
