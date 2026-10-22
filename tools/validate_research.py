"""Validate benchmark provenance and documentation without running vendor code."""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'docs/research/evidence'
mapping = json.loads((ROOT / 'docs/research/document-map.json').read_text(encoding='utf-8'))
sources = json.loads((EVIDENCE / 'source-manifest.json').read_text(encoding='utf-8'))
host = json.loads((EVIDENCE / 'host-reference-manifest.json').read_text(encoding='utf-8'))
sources.append(host)
lookup = {row['product']: row for row in sources}
claims = json.loads((EVIDENCE / 'claim-ledger.json').read_text(encoding='utf-8'))
errors = []
for row in sources:
    if 'archive_sha256' not in row:
        continue
    archive = Path(row['source_path']).parent / 'source.zip'
    if hashlib.sha256(archive.read_bytes()).hexdigest() != row['archive_sha256']:
        errors.append('archive mismatch: ' + row['product'])
seen = set()
for claim in claims:
    if claim['id'] in seen:
        errors.append('duplicate claim ID: ' + claim['id'])
    seen.add(claim['id'])
    source = lookup[claim['product']]
    path = Path(source['source_path']) / claim['file']
    lines = path.read_text(encoding='utf-8').splitlines()
    if not (1 <= claim['start'] <= claim['end'] <= len(lines)):
        errors.append('invalid source range: ' + claim['id'])
    if source['sha'] != claim['sha']:
        errors.append('revision mismatch: ' + claim['id'])
    claim['file_sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
(EVIDENCE / 'claim-ledger.json').write_text(json.dumps(claims, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

lint = []
parity = []
for row in mapping:
    process = subprocess.run([
        'node', 'C:/Users/jhjang/.agents/skills/structured-reporting/cli/document.mjs',
        'lint', str(ROOT / row['markdown']), '--json',
    ], capture_output=True, cwd=ROOT)
    result = json.loads(process.stdout.decode('utf-8'))
    lint.append(result)
    if process.returncode:
        errors.append('document lint failed: ' + row['slug'])
    local_raw = (ROOT / row['markdown']).read_text(encoding='utf-8')
    local = local_raw.strip()
    html_page = (ROOT / row['html']).read_text(encoding='utf-8')
    digest = hashlib.sha256(local_raw.encode()).hexdigest()
    html_hash = re.search(r'<meta name="source-sha256" content="([a-f0-9]+)"', html_page)
    html_equal = bool(html_hash and html_hash.group(1) == digest)
    if not html_equal:
        errors.append('HTML source hash mismatch: ' + row['slug'])
    wiki = Path(row['wiki_path']).read_text(encoding='utf-8')
    wiki = wiki[wiki.index('<!-- sr:plan'):]
    # kg_update_node adds an empty Progress timestamp; this is operational metadata.
    wiki = re.sub(r'\n## Progress\n\n> [^\n]+\s*\Z', '', wiki).strip()
    equal = local == wiki
    if not equal:
        errors.append('wiki body mismatch: ' + row['slug'])
    parity.append({'slug': row['slug'], 'wiki_body_equal': equal,
                   'html_source_hash_equal': html_equal, 'body_sha256': digest})
(EVIDENCE / 'document-lint.json').write_text(json.dumps(lint, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
result = {'date': '2026-10-22', 'documents': len(mapping), 'claims': len(claims),
          'source_archives_verified': len(sources) - 1,
          'lint_blocking': sum(row['summary']['blocking'] for row in lint),
          'lint_warnings': sum(row['summary']['warning'] for row in lint),
          'body_parity': parity, 'errors': errors,
          'runtime_verification': 'not executed; vendor code not installed or run'}
(EVIDENCE / 'review-validation.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'documents': len(mapping), 'claims': len(claims), 'errors': errors,
                  'findings': [{'file': row['file'], 'findings': row['findings']} for row in lint if row['findings']]}, ensure_ascii=False, indent=2))
if errors:
    raise SystemExit(1)
