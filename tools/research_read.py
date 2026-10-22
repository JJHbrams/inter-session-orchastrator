"""Print numbered lines from a pinned benchmark source without executing it."""
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'docs/research/evidence/source-manifest.json').read_text(encoding='utf-8'))
product, relative = sys.argv[1:3]
record = next(row for row in manifest if row['product'] == product)
source = Path(record['source_path']).resolve()
path = (source / relative).resolve()
if not path.is_relative_to(source):
    raise ValueError('Source path must stay inside its snapshot')
lines = path.read_text(encoding='utf-8', errors='replace').splitlines()
start = int(sys.argv[3]) if len(sys.argv) > 3 else 1
end = int(sys.argv[4]) if len(sys.argv) > 4 else min(len(lines), start + 160)
print(f'{product}@{record["sha"]} / {relative}')
for index in range(start - 1, min(end, len(lines))):
    print(f'{index + 1}: {lines[index]}')
