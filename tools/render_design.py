"""Render the design document as a self-contained, offline review page."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
from pathlib import Path

import markdown


ROOT = Path(__file__).resolve().parents[1]


def render(bundle: Path, source: Path | None = None, output: Path | None = None,
           review_label: str = "BUILDING · 실행판 검증", kind: str = "BENCHMARK → DESIGN",
           shared_bundle: str | None = None) -> None:
    source = source or ROOT / "docs/design/0001-session-rooms.md"
    raw = source.read_text(encoding="utf-8")
    body = re.sub(r"\A---\n.*?\n---\n\n?", "", raw, count=1, flags=re.S)
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
    title_match = re.search(r"^# (.+)$", body, re.M)
    title = title_match.group(1) if title_match else source.stem
    content = markdown.markdown(body, extensions=["tables", "fenced_code", "toc"])
    content = re.sub(
        r'<pre><code class="language-mermaid">(.*?)</code></pre>',
        r'<pre class="mermaid">\1</pre>',
        content,
        flags=re.S,
    )
    content = re.sub(r"<table>(.*?)</table>", r'<div class="table-scroll"><table>\1</table></div>', content, flags=re.S)
    if source.parent == ROOT / "docs/research":
        mapping = json.loads((ROOT / 'docs/research/document-map.json').read_text(encoding='utf-8'))
        known = {row['slug'] for row in mapping}
        local_links = {slug: slug + '.html' for slug in known}
        local_links.update({'inter-session-index': 'index.html', 'session-room-foundation': '../index.html'})
        content = re.sub(r'\[\[([\w-]+)\]\]', lambda m: f'<a href="{local_links[m[1]]}">{m[1]}</a>' if m[1] in local_links else m[0], content)
    elif source == ROOT / "docs/design/0001-session-rooms.md" or source.parent == ROOT / "docs":
        mapping_path = ROOT / 'docs/research/document-map.json'
        if mapping_path.exists():
            mapping = json.loads(mapping_path.read_text(encoding='utf-8'))
            local_links = {row['slug']: 'research/' + row['slug'] + '.html' for row in mapping}
            local_links.update({'inter-session-index': 'research/index.html', 'session-room-foundation': 'index.html'})
            local_links['session-room-runtime-validation'] = 'runtime-validation.html'
            content = re.sub(r'\[\[([\w-]+)\]\]', lambda m: f'<a href="{local_links[m[1]]}">{m[1]}</a>' if m[1] in local_links else m[0], content)
    headings = re.findall(r'<h2 id="([^"]+)">(.*?)</h2>', content)
    nav = "\n".join(f'<a href="#{html.escape(anchor)}">{label}</a>' for anchor, label in headings)
    if source.parent == ROOT / "docs/research":
        nav = '<a href="index.html">← 조사 자료 목록</a>\n' + nav
    elif (ROOT / "docs/research/index.html").exists():
        nav = '<a href="research/index.html">최신 벤치마킹 조사 →</a>\n' + nav
    script = bundle.read_text(encoding="utf-8").replace("</script", "<\\/script")
    license_file = bundle.parent.parent / "LICENSE"
    license_text = license_file.read_text(encoding="utf-8") if license_file.exists() else "Mermaid is distributed under the MIT license. See https://github.com/mermaid-js/mermaid/blob/develop/LICENSE"
    css = """
    :root{--ink:#202c35;--muted:#64757a;--accent:#006c62;--line:#dce4e4;--paper:#fff;--bg:#f3f6f5}
    *{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:24px}
    body{margin:0;color:var(--ink);background:var(--bg);font:15px/1.85 'Segoe UI','Malgun Gothic',sans-serif}
    a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
    .shell{display:grid;grid-template-columns:222px minmax(0,1fr);max-width:1640px;margin:auto}
    aside{position:sticky;top:0;height:100vh;padding:38px 20px;overflow:auto;border-right:1px solid var(--line)}
    .brand{font-size:12px;letter-spacing:.1em;font-weight:800;color:var(--accent);line-height:1.6;margin-bottom:18px}
    .status{display:inline-block;background:#f9e9c6;color:#795308;border-radius:5px;padding:2px 8px;font-size:11px;font-weight:700}
    nav{margin-top:25px}nav a{display:block;font-size:12px;color:var(--muted);padding:7px 0;line-height:1.5}
    nav a:hover{color:var(--accent)}main{min-width:0;padding:40px 52px 80px;background:var(--paper)}
    .meta{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid var(--accent);padding-bottom:17px;font-size:11px;font-weight:600;color:var(--muted);letter-spacing:.08em}
    h1{font-size:34px;line-height:1.45;letter-spacing:-1.1px;margin:30px 0 22px;font-weight:750;max-width:900px}
    h2{font-size:23px;line-height:1.5;margin:54px 0 20px;padding-top:20px;border-top:1px solid var(--line);letter-spacing:-.5px}
    h3{font-size:17px;margin:28px 0 12px;color:var(--accent)}p{margin:12px 0;max-width:1060px}
    blockquote{margin:20px 0;padding:15px 20px;border-left:4px solid var(--accent);background:#edf6f3;color:#345e58}
    blockquote p{margin:0}ul,ol{padding-left:23px}li{margin:5px 0}
    .table-scroll{overflow:auto;max-width:100%;margin:18px 0 26px;border:1px solid var(--line);border-radius:8px}
    table{border-collapse:collapse;width:100%;font-size:13px;line-height:1.75}
    th{background:#edf3f2;color:#24463f;font-weight:700;text-align:left;white-space:nowrap}
    td,th{padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:top;min-width:105px}
    tr:last-child td{border-bottom:0}td:first-child{font-weight:600}tr:nth-child(even){background:#fafcfc}
    code{font:12px/1.6 Consolas,'Malgun Gothic',monospace;background:#edf2f2;padding:2px 4px;border-radius:3px;overflow-wrap:anywhere}
    pre{padding:20px;overflow:auto;border-radius:8px;background:#152c2c;color:#e7f2ef;font:12px/1.9 Consolas,'Malgun Gothic',monospace}
    pre code{padding:0;background:none;color:inherit;font:inherit;overflow-wrap:normal}
    pre.mermaid{background:#f7faf9;color:var(--ink);border:1px solid var(--line);text-align:center;padding:24px 12px}
    .mermaid svg{max-width:100%!important;height:auto!important;display:block;margin:auto}
    footer{margin-top:50px;border-top:1px solid var(--line);padding-top:18px;color:var(--muted);font-size:11px;overflow-wrap:anywhere}
    .skip{position:absolute;left:-9999px}.skip:focus{left:16px;top:10px;background:white;padding:8px;z-index:10}
    @media(max-width:1000px){.shell{grid-template-columns:180px minmax(0,1fr)}main{padding:28px}aside{padding:28px 15px}h1{font-size:28px}}
    @media(max-width:700px){.shell{display:block}aside{position:static;height:auto;padding:20px;border:0;border-bottom:1px solid var(--line)}nav{display:none}main{padding:22px 18px}h1{font-size:25px}td,th{min-width:135px}h2{font-size:21px}}
    @media print{aside,.skip{display:none}.shell{display:block}main{padding:0}.table-scroll{overflow:visible}pre.mermaid{break-inside:avoid}body{background:white}}
    """
    script_tag = f'<script src="{html.escape(shared_bundle)}"></script>' if shared_bundle else f'<script>{script}</script>'
    source_label = source.relative_to(ROOT).as_posix()
    page = f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="source-sha256" content="{digest}"><title>{html.escape(title)}</title><style>{css}</style></head>
<body><a class="skip" href="#document">본문으로 이동</a><div class="shell">
<aside><div class="brand">INTER SESSION<br>ORCHESTRATOR</div><span class="status">{html.escape(review_label)}</span><nav aria-label="문서 목차">{nav}</nav></aside>
<main id="document"><header class="meta"><span>{html.escape(kind)}</span><span>2026.10.22 · WINDOWS / LOCAL</span></header>
<article>{content}</article><footer>원본: {html.escape(source_label)}<br>본문 SHA-256: {digest}</footer></main></div>
<!-- Mermaid third-party license: {html.escape(license_text).replace('--', '—')} -->
{script_tag}<script>
window.designRenderDone=false;
mermaid.initialize({{startOnLoad:false,securityLevel:'strict',theme:'base',themeVariables:{{fontFamily:'Segoe UI, Malgun Gothic, sans-serif',primaryColor:'#e6f2ee',primaryTextColor:'#202c35',lineColor:'#4c7972',primaryBorderColor:'#76a69b'}}}});
mermaid.run({{querySelector:'.mermaid'}}).then(()=>{{window.designRenderDone=true}}).catch(e=>{{window.designRenderError=String(e);console.error(e)}});
</script></body></html>"""
    output = output or ROOT / "docs/index.html"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(page, encoding="utf-8")
    print(json.dumps({"output": str(output), "body_sha256": digest, "diagram_count": content.count('class="mermaid"'), "bytes": output.stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mermaid-bundle", type=Path, default=ROOT.parent / "drt-notebookLM/frontend/node_modules/mermaid/dist/mermaid.min.js")
    args = parser.parse_args()
    if not args.mermaid_bundle.is_file():
        parser.error("Provide a local Mermaid browser bundle with --mermaid-bundle.")
    render(args.mermaid_bundle)
