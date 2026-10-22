"""Collect selected OpenClaw reference sources without downloading its runtime."""
import datetime as dt
import hashlib
import json
from pathlib import Path

from collect_benchmarks import api, download, CACHE, OUT

repo = 'openclaw/openclaw'
commit = api('repos/' + repo + '/commits/HEAD')
sha = commit['sha']
source = CACHE / 'openclaw' / sha / 'source'
files = [
    'LICENSE', 'package.json', 'docs/concepts/session-tool.md',
    'src/agents/tools/sessions-send-tool.ts',
    'src/agents/tools/sessions-send-tool.input.ts',
    'src/agents/tools/sessions-send-tool.delivery.ts',
    'src/agents/tools/sessions-send-followup.ts',
    'src/agents/tools/sessions-send-reply-flow.ts',
    'src/sessions/input-provenance.ts',
]
records = []
for relative in files:
    url = f'https://raw.githubusercontent.com/{repo}/{sha}/{relative}'
    target = source / relative
    try:
        data = download(url)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        records.append({'path': relative, 'url': url, 'sha256': hashlib.sha256(data).hexdigest()})
    except Exception as error:
        records.append({'path': relative, 'url': url, 'error': str(error)})
result = {'product': 'openclaw', 'repository': repo, 'sha': sha,
          'commit_date_utc': commit['commit']['committer']['date'],
          'retrieved_at_utc': dt.datetime.now(dt.timezone.utc).isoformat(),
          'source_path': str(source), 'files': records,
          'verification_level': 'selected pinned source files, no runtime execution'}
(OUT / 'host-reference-manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'product': 'openclaw', 'sha': sha, 'files': len(records), 'errors': [r for r in records if 'error' in r]}))
