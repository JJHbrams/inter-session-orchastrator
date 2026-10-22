"""Build an offline benchmark reading hub from the Wiki-mirrored Markdown."""
import html
import json
import shutil
from pathlib import Path

from render_design import ROOT, render

folder = ROOT / 'docs/research'
mapping = json.loads((folder / 'document-map.json').read_text(encoding='utf-8'))
bundle = ROOT.parent / 'drt-notebookLM/frontend/node_modules/mermaid/dist/mermaid.min.js'
assets = folder / 'assets'
assets.mkdir(exist_ok=True)
shutil.copyfile(bundle, assets / 'mermaid.min.js')
shutil.copyfile(bundle.parent.parent / 'LICENSE', assets / 'mermaid-LICENSE')
for row in mapping:
    render(bundle, ROOT / row['markdown'], ROOT / row['html'],
           review_label='정적 조사 · 실행 미검증', kind='BENCHMARK → EVIDENCE',
           shared_bundle='assets/mermaid.min.js')

order = ['benchmark-analysis', 'benchmark-sources', 'magents-benchmark', 'intercom-benchmark',
         'agentmux-benchmark', 'orchestra-benchmark', 'host-reference-benchmark', 'benchmark-validation-plan']
by_id = {row['slug']: row for row in mapping}
descriptions = {
    'benchmark-analysis': '기존 세션·Windows·응답·복구·권한의 차이와 초안 재검토 사항',
    'benchmark-sources': '고정 커밋, archive hash, 원자료와 claim ledger, 검증 범위',
    'magents-benchmark': '세션 탐색, IPC·socket, 실패 후 CLI 재개와 mailbox 순서',
    'intercom-benchmark': '작은 MCP mailbox, 자동 steer, claim 복구의 증거 한계',
    'agentmux-benchmark': '영속 대기열·제출 fence·불확실성 보존·실행 정책',
    'orchestra-benchmark': '요청별 UI, idle·초안 보호, 프로젝트 경계와 running 의미',
    'host-reference-benchmark': 'OpenClaw 의미론·현재 Orca 기능·NotebookLM 재사용 의존성',
    'benchmark-validation-plan': '기존 세션의 identity·busy·초안·crash·응답을 검증할 13개 시나리오',
}
cards = '\n'.join(f'<a class="card" href="{slug}.html"><span class="number">{index+1:02d}</span><h2>{html.escape(by_id[slug]["title"])}</h2><p>{descriptions[slug]}</p><span class="read">문서 읽기 →</span></a>' for index, slug in enumerate(order))
page = f'''<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Inter Session — 벤치마킹 조사 자료</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#f2f5f3;color:#20332e;font:15px/1.8 'Segoe UI','Malgun Gothic',sans-serif}}main{{max-width:1200px;margin:auto;padding:44px 40px 70px}}a{{color:inherit;text-decoration:none}}.top{{font-size:12px;letter-spacing:.12em;color:#477269;font-weight:700;border-bottom:2px solid #176b59;padding-bottom:18px;display:flex;justify-content:space-between;gap:15px}}h1{{font-size:42px;line-height:1.35;letter-spacing:-1px;margin:38px 0 18px}}.lead{{max-width:850px;color:#526a61;font-size:17px}}.facts{{display:flex;flex-wrap:wrap;gap:12px;margin:28px 0 35px}}.facts span{{background:#dfece6;color:#285f50;padding:8px 14px;border-radius:6px;font-size:13px;font-weight:600}}.grid{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}}.card{{background:white;border:1px solid #d9e2dd;border-radius:12px;padding:24px 26px;display:block;min-height:205px;transition:transform .15s,border-color .15s}}.card:hover{{border-color:#438570;transform:translateY(-2px)}}.number{{font-size:12px;color:#77958a;font-weight:700}}h2{{font-size:20px;line-height:1.45;margin:12px 0 10px;letter-spacing:-.4px}}.card p{{font-size:14px;color:#61796e;margin:0 0 18px}}.read{{font-size:12px;color:#176b59;font-weight:700}}.note{{margin-top:32px;padding:20px 24px;background:#e8eee9;border-radius:9px;color:#4e665a;font-size:13px}}.links{{margin-top:22px;display:flex;gap:25px;font-size:13px;color:#176b59}}.links a:hover{{text-decoration:underline}}@media(max-width:700px){{main{{padding:26px 20px}}h1{{font-size:30px}}.grid{{grid-template-columns:1fr}}.top{{font-size:10px}}.card{{min-height:180px}}}}@media(prefers-reduced-motion:reduce){{.card{{transition:none}}}}
</style></head><body><main><header class="top"><span>INTER SESSION ORCHESTRATOR</span><span>2026.10.22 · RESEARCH BASELINE</span></header><h1>만들기 전에,<br>이미 풀린 문제부터 확인.</h1><p class="lead">Windows에서 작업 중인 Codex·Claude 세션을 토론장으로 모으기 위한 조사 자료. 공개 소스의 고정 revision과 현재 호스트의 실제 가이드를 기준으로 연결·응답·복구의 경계를 검토했다.</p><div class="facts"><span>조사 문서 8개</span><span>고정 소스 근거 46개</span><span>제품 소스 4종 + 기준 플랫폼·로컬 UI</span><span>제품 실행 검증은 미수행</span></div><section class="grid" aria-label="조사 문서 목록">{cards}</section><div class="note"><strong>읽는 순서</strong> — 종합 분석 → 필요한 제품별 조사 → 원자료·소스 행 대조 → 후속 검증 계획.<br>자료 다운로드와 정적 분석은 실제 설치·LLM 세션 연결 성공을 의미하지 않는다. 앱 구현은 아직 시작하지 않았다.</div><div class="links"><a href="../index.html">이전 설계 초안 보기</a><a href="evidence/review-validation.json">검증 기록 보기</a><a href="evidence/claim-ledger.json">소스 근거 ledger 보기</a></div></main></body></html>'''
(folder / 'index.html').write_text(page, encoding='utf-8')
render(bundle)
print('Research hub:', folder / 'index.html')
