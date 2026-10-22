# Inter Session Orchestrator

Windows에서 기존 Codex·Claude 작업 세션을 채널과 토론 단위로 모아 협업하는 개인용 앱.

현재 단계는 **벤치마킹 결과를 반영한 설계 초안 검토**다. 연결 모드·권한·상태·복구 규칙을 수용 기준 10개와 실행 계획 V-01~V-13에 연결했다. 앱, MCP 서버, provider 연결은 아직 구현되지 않았다.

- [벤치마킹 조사 자료 목록](docs/research/index.html)
- [종합 분석](docs/research/benchmark-analysis.md)
- [원자료와 검증 범위](docs/research/benchmark-sources.md)
- [후속 검증 계획](docs/research/benchmark-validation-plan.md)
- Engram Wiki: `projects/inter-session-orchastrator/index.md`에서 같은 조사 자료와 분석보고서로 연결된다.

- [설계와 벤치마킹](docs/design/0001-session-rooms.md)
- [HTML 검토본](docs/index.html)
- 첫 검증: Orca의 기존 Codex·Claude 세션 두 개에 정확히 요청하고, 원래 세션 맥락과 응답 연결을 보존한다.

설계 검증:

```powershell
node C:/Users/jhjang/.agents/skills/feature-spec/spec.mjs check --repo .
node C:/Users/jhjang/.agents/skills/structured-reporting/cli/document.mjs lint docs/design/0001-session-rooms.md
python tools/render_design.py
python tools/validate_research.py
python tools/render_research.py
```

렌더링은 Python의 markdown 패키지가 필요하다. Mermaid 번들은 --mermaid-bundle 경로로 제공하거나 로컬 NotebookLM 후보에서 찾는다. HTML에 번들이 포함되므로 생성 후에는 네트워크 연결이 필요하지 않다.

실제 세션에 메시지를 보내거나 사용자 전역 설정을 바꾸는 동작은 문서 생성에 포함되지 않는다.
