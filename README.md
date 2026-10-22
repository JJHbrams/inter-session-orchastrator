# Inter Session Orchestrator

Windows에서 기존 Codex·Claude 작업 세션을 채널과 토론 단위로 모아 협업하는 개인용 앱.

현재 단계는 **로컬 브라우저 실행판 검증 완료 / 전체 명세 building**이다. 채널·참석자·공동 대화·별칭 멘션, SQLite outbox/writer/fence, room-scoped HTTP와 실제 stdio MCP를 구현했다. 사용자 지정 신규 Codex·Claude 세션에서 응답 3건과 좌장 제안 1건을 확인했고, 후속 프로필·멘션·이모지 기능까지 자동화 테스트 22개가 통과했다.

좌장 수신 경로를 추가한 최신 테스트는 23개 통과했다. 입력창의 **좌장에게**를 고르면 좌장 프로필을 미리 보여주며, 본문에 다른 별칭을 언급해도 좌장 한 명만 수신한다. 좌장 부재·읽기 전용·모호함은 전송을 막는다. 이 선택은 좌장의 자동 wake와 자율 토론 실행을 대신하지 않는다.

## 실행

Node 24.14.1에서 검증했다. 외부 npm 의존 패키지는 없다. 내장 SQLite는 experimental 경고가 표시된다.

```powershell
npm start
```

[로컬 앱 열기](http://127.0.0.1:4318/). 데이터는 Git에서 제외된 `.local/rooms.sqlite`에 저장한다. `PORT`와 `ROOMS_DB`로 실행 위치를 조정할 수 있다. Orca discovery·출력 조회는 실행 프로세스가 Orca 로컬 IPC에 접근할 수 있어야 한다.

앱에서 토론장을 만들고 정확한 세션 신원·연결 모드·허용 범위를 확인해 초대한다. 참여 정보 발급 결과는 선택한 참여자의 비공개 `.local` 설정에만 저장한다. inbox는 참여자가 직접 읽는다. 기존 작업 세션의 자동 wake·busy/draft 입력 보호·자동 host 응답 회수는 아직 구현되지 않았다. 이번 실제 검증은 새 두 세션을 검증자가 명시적으로 호출한 방식이다.

## MCP와 참여자

참여 세션에는 지속되는 랜덤 별칭과 색상 프로필이 배정된다. `@이름`으로 한 명 또는 여러 명에게 질문하며, 후보는 방향키·Enter·Tab으로 선택한다. 전송 전에 수신자를 미리 보여주고 모르는 별칭·작성 중인 `@`·읽기 전용 대상은 차단한다. 멘션 없는 질문은 미리보기에 나온 참여 가능 세션 전체를 대상으로 한다. 게시 모드와 이모지 반응은 실행 요청을 만들지 않는다.

참석자 카드와 발언에는 동일 프로필·별칭을, provider는 보조 배지로 표시한다. 생성 테두리는 실제 저장된 running 상태에서만 켜진다. 👍 ❤️ 💡 👀 반응은 로컬 사용자의 피드백이며 새로고침 후에도 유지된다.

`packages/mcp/server.js`는 stdio JSON-RPC MCP 서버다. 실행 환경의 `ROOMS_URL=http://127.0.0.1:4318`과 `ROOMS_TOKEN`으로 선택한 room registration을 전달한다. 토큰은 명령 인자·Git·공유 프롬프트에 넣지 않는다. 도구는 `room_context`, `room_post`, `room_request`, `room_reply`, `room_inbox`, `room_result`다. 모델 클라이언트의 네이티브 MCP 설정은 이번 검증에서 변경하지 않았다.

HTTP helper는 발급받은 비공개 설정 파일 `{ "url": "http://127.0.0.1:4318", "token": "발급값" }`을 사용한다.

```powershell
node packages/mcp/participant.js --config .local/participant.json inbox
node packages/mcp/participant.js --config .local/participant.json reply REQUEST_ID "답변"
node packages/mcp/participant.js --config .local/participant.json request .local/question.json
```

요청 JSON은 `body`, 대상 membership ID 배열 `targets`, 선택적 `requestKey`를 가진다. helper는 명시 키가 없으면 입력 JSON hash를 사용한다. 같은 내용으로 별도 새 요청을 만들려면 새 키를 지정한다. `completed`는 상관 응답 회수를 뜻하고 작업 성공은 별도 outcome이다. 제출 결과가 unknown이면 자동 재전송하지 않는다.

API는 loopback·Host/Origin·CSRF·HttpOnly SameSite 쿠키와 room 등록으로 범위를 제한한다. 동일 Windows 사용자 프로세스는 신뢰 경계 안에 있다. 설치형 shell, provider별 new/resume/fork, 전용 세 번째 좌장 및 자동 진행은 후속 작업이다.

## 검증과 문서

```powershell
npm test
```

storage 17개, persona/parser/migration 3개, 실제 HTTP/MCP 통합 1개, stdio 초기화 1개가 통과했다. 이 테스트가 원래 V-01~V-13의 실제 host 검증을 대체하지는 않는다.

- [실행·검증 보고서](docs/runtime-validation.html) / [원문](docs/runtime-validation.md)
- [프로필·멘션·이모지 기능 명세](docs/session-personas.html) / [원문](docs/design/0002-session-personas.md)
- [검증 근거 JSON](docs/validation/runtime.json)
- [1440×900 실제 화면](docs/screenshots/rooms-1440x900.png) / [1280×800](docs/screenshots/rooms-1280x800.png)

- [벤치마킹 조사 자료 목록](docs/research/index.html)
- [종합 분석](docs/research/benchmark-analysis.md)
- [원자료와 검증 범위](docs/research/benchmark-sources.md)
- [후속 검증 계획](docs/research/benchmark-validation-plan.md)
- Engram Wiki: `projects/inter-session-orchastrator/index.md`에서 같은 조사 자료와 분석보고서로 연결된다.

- [설계와 벤치마킹](docs/design/0001-session-rooms.md)
- [HTML 검토본](docs/index.html)
- 다음 검증: 기존 cross-project 작업 세션의 신원·정책·busy/draft·host 제출/응답을 지원된 경로로 대조한다.

설계 검증:

```powershell
node C:/Users/jhjang/.agents/skills/feature-spec/spec.mjs check 0001-session-rooms --repo .
node C:/Users/jhjang/.agents/skills/feature-spec/spec.mjs check 0002-session-personas --repo .
node C:/Users/jhjang/.agents/skills/structured-reporting/cli/document.mjs lint docs/design/0001-session-rooms.md
python tools/render_design.py
python tools/validate_research.py
python tools/render_research.py
```

렌더링은 Python의 markdown 패키지가 필요하다. Mermaid 번들은 --mermaid-bundle 경로로 제공하거나 로컬 NotebookLM 후보에서 찾는다. HTML에 번들이 포함되므로 생성 후에는 네트워크 연결이 필요하지 않다.

검증 모델의 HTTP helper 사용과 별도 stdio MCP 프로토콜 검증은 보고서에서 구분했다. 전역 provider 설정은 변경하지 않았다.
