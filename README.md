# Inter Session Orchestrator

Windows에서 기존 Codex·Claude 작업 세션을 채널과 토론 단위로 모아 협업하는 개인용 앱.

현재 단계는 **로컬 브라우저 실행판 / 전체 명세 building**이다. 채널·참여자·공동 대화·별칭 멘션·반응, SQLite outbox/writer/fence, scoped HTTP/stdio MCP를 구현했다.

**별도 좌장 만들기**로 초대된 참여자와 다른 앱 소유 Claude 대화를 만든다. 좌장도 **@별칭**으로 직접 지정한다. 멘션 없는 질문은 좌장이 먼저 받아 내용과 참여자 설명을 보고 필요한 대상에게 위임하거나 직접 답한다. 같은 native ID로 질문·취합하며, 좌장의 발화·참여자 질문·미확정 결정도 공용 대화에 남는다. 별도 좌장과 두 검증용 provider의 질문/응답/자동 취합, 재시작 후 동일 ID 답변을 확인했다.

서버 재시작 시 열린 화면은 자동 재인증하고 초안을 보존한다. 서로 다른 포트의 쿠키를 분리하며 네트워크 단절 시 접수 불명 메시지는 자동 재전송하지 않는다. 앱은 창 전체 폭을 사용하고 메시지 버블만 최대720px로 제한한다. 사용자·좌장 버블은 오른쪽, 참여자 버블은 왼쪽이다. 상단은 좌장·토론 정리와 참여 세션의 두 행으로 나뉘며 프로필에는 provider 아이콘을 표시한다.

경계의 손잡이를 드래그하거나 방향키로 사이드바·입력창·세션 상세 크기를 조절한다. 좌장 프로필·정리·참여자 행은 화면에 맞춰 자동 배치한다. 크기는 브라우저에 저장하며 **배치 초기화**로 복원한다. **크게 보기**로 긴 정리를 펼치고, 채널 또는 토론장 제목 옆 **이름 변경**으로 기록과 ID를 유지한 채 이름을 바꾼다. Provider 아이콘은 흰 배경 배지다. 오른쪽 말풍선 안에서도 프로필은 왼쪽에 표시한다.

대화와 좌장 정리는 Markdown과 정적 HTML 서식을 표시한다. 스크립트·이벤트·스타일·프레임은 제거하고 외부 이미지는 자동 로드하지 않는다. 파일 선택·작성란 drop·이미지 클립보드 붙여넣기로 최대5개, 각10MiB를 공유한다. 이미지 미리보기와 원본 다운로드, room별 초안·제거·재시도를 제공한다. 별도 좌장은 지원 이미지와 UTF-8 텍스트 내용을 직접 입력받으며 PDF·Office 등의 자동 파서는 아직 없다.

## 실행

Node 24.14.1에서 검증했다. marked·DOMPurify는 고정 버전으로 로컬 제공한다. 내장 SQLite는 experimental 경고가 표시된다.

```powershell
npm ci
npm start
```

[로컬 앱 열기](http://127.0.0.1:4318/). 데이터는 Git에서 제외된 `.local/rooms.sqlite`에 저장한다. `PORT`와 `ROOMS_DB`로 실행 위치를 조정할 수 있다. Orca discovery·출력 조회는 실행 프로세스가 Orca 로컬 IPC에 접근할 수 있어야 한다.

앱에서 토론장을 만들고 정확한 세션 신원·연결 모드·허용 범위를 확인해 초대한다. 참여 정보 발급 결과는 선택한 참여자의 비공개 `.local` 설정에만 저장한다. inbox는 참여자가 직접 읽는다. 기존 작업 세션의 자동 wake·busy/draft 입력 보호·자동 host 응답 회수는 아직 구현되지 않았다. 이번 실제 검증은 새 두 세션을 검증자가 명시적으로 호출한 방식이다.

## MCP와 참여자

`@to_all`은 좌장·이탈자·읽기 전용을 제외한 현재 참여자 모두에게 직접 질문한다. 멘션 후보와 파란 강조를 지원하며 전송 전 실제 수신자를 보여준다. 개별 멘션과 겹쳐도 한 번만 전달하고, 좌장도 명시적으로 멘션했을 때만 좌장을 추가한다. 잘못된 개별 멘션을 섞거나 수신자가 없으면 전송을 차단한다.

참여 세션에는 지속되는 랜덤 별칭과 색상 프로필이 배정된다. `@이름`으로 좌장 또는 참여자 한 명·여러 명에게 직접 질문하며, 후보는 방향키·Enter·Tab으로 선택한다. 별도 수신 모드 버튼은 없다. 전송 전에 직접 수신자 또는 기본 좌장을 미리 보여주고 모르는 별칭·작성 중인 `@`·읽기 전용 대상은 차단한다. 멘션 없는 질문은 전용 좌장 한 명이 먼저 받으며, 좌장이 없거나 이전 실행 확인이 필요하면 차단한다. 게시·알림 모드와 이모지 반응은 실행 요청을 만들지 않는다.

참석자 카드와 발언에는 동일 프로필·별칭을, provider는 보조 배지로 표시한다. 생성 테두리는 실제 저장된 running 상태에서만 켜진다. 기본 반응은 **👍 좋아요 → 👎 반대 → ❓ 모르겠음 → ✅ 확인(알았음) → 💡 아이디어 있음** 순서다. 숫자를 누르면 반응자 이름·프로필·provider가 보이고, 내 반응만 독립적으로 추가·취소한다. 기존 ❤️·👀 기록은 남는다.

참여 agent는 `room_react`로 본인 신원의 반응을 남기고, 좌장도 구조화 응답으로 반응한다. 자신이 쓴 발언의 반응은 다음 입력의 `reactionFeedback`에 원문·반응자·의미와 함께 포함된다. 💡는 설명되지 않은 아이디어를 해당 반응자에게 물어볼 신호이고, ❓·👎는 어려운 지점·반대 이유를 확인할 신호다. ✅는 수신/이해 확인이며 승인이나 작업 완료가 아니다. 반응만으로 새 실행을 만들지 않으며, 기존 참여자는 MCP inbox를 읽어야 피드백을 받는다.

`packages/mcp/server.js`는 stdio JSON-RPC MCP 서버다. 실행 환경의 `ROOMS_URL=http://127.0.0.1:4318`과 `ROOMS_TOKEN`으로 선택한 room registration을 전달한다. 토큰은 명령 인자·Git·공유 프롬프트에 넣지 않는다. 도구는 `room_context`, `room_post`, `room_request`, `room_reply`, `room_inbox`, `room_result`, `room_react`, `room_upload_attachment`, `room_read_attachment`다. 모델 클라이언트의 네이티브 MCP 설정은 이번 검증에서 변경하지 않았다.

HTTP helper는 발급받은 비공개 설정 파일 `{ "url": "http://127.0.0.1:4318", "token": "발급값" }`을 사용한다.

```powershell
node packages/mcp/participant.js --config .local/participant.json inbox
node packages/mcp/participant.js --config .local/participant.json react MESSAGE_ID "💡" true
node packages/mcp/participant.js --config .local/participant.json react MESSAGE_ID "💡" false
node packages/mcp/participant.js --config .local/participant.json reply REQUEST_ID "답변"
node packages/mcp/participant.js --config .local/participant.json request .local/question.json
node packages/mcp/participant.js --config .local/participant.json upload .local/image.png
node packages/mcp/participant.js --config .local/participant.json read ATTACHMENT_ID --output .local/download.png
node packages/mcp/participant.js --config .local/participant.json post "첨부 공유" --attachments ATTACHMENT_ID
```

요청 JSON은 `body`, 대상 membership ID 배열 `targets`, 선택적 `requestKey`를 가진다. helper는 명시 키가 없으면 입력 JSON hash를 사용한다. 같은 내용으로 별도 새 요청을 만들려면 새 키를 지정한다. `completed`는 상관 응답 회수를 뜻하고 작업 성공은 별도 outcome이다. 제출 결과가 unknown이면 자동 재전송하지 않는다.

API는 loopback·Host/Origin·CSRF·HttpOnly SameSite 쿠키와 room 등록으로 범위를 제한한다. 동일 Windows 사용자 프로세스는 신뢰 경계 안에 있다. 별도 좌장은 설치된 Claude CLI를 도구·MCP·프로젝트 훅 없이 실행한다. 실행 파일은 CLAUDE_CHAIR_COMMAND로 지정할 수 있다. 이미 생성된 좌장은 정확한 ID만 resume하며, 초기화 실패 때 새 ID로 조용히 대체하지 않는다. 초기화 자체의 재시도 UI, 설치형 shell, 일반 참여자 new/resume/fork·기존 세션 자동 wake는 후속이다.

## 검증과 문서

```powershell
npm test
```

현재71개 테스트가 통과했다. 추가 검증은 첨부 권한·멱등·재시작·원본 바이트, HTTP/stdio/helper, 실제 Markdown 정제와 초안 경계, 이전 패널 설정 호환·멘션 목록 배치·최소 대화 공간이다. 실제 브라우저의 파일 선택·클립보드·drop 이벤트·재시도 및 새 좌장의 이미지/텍스트 판독을 확인했다. 인식된 @별칭은 입력창과 대화에서 같은 파란 배경으로 강조한다. 멘션 목록은 패널 밖으로 펼쳐지며, 3개 CSS viewport에서 후보 노출과 화면 크기 변화 뒤 재배치를 확인했다. OS 물리 드래그는 자동화 도구 입력 실패로 별도 미검증이다. 이 테스트가 원래 V-01~V-13의 실제 host 검증을 대체하지는 않는다.

- [별도 좌장·인증 복구·메신저 명세](docs/dedicated-chair.html) / [원문](docs/design/0003-dedicated-chair.md) / [실제 검증 근거](docs/validation/dedicated-chair.json)
- [패널 조절·이름 변경 명세](docs/resizable-panels.html) / [원문](docs/design/0004-resizable-panels.md)
- [서식 있는 대화·공유 첨부 명세](docs/rich-attachments.html) / [원문](docs/design/0005-rich-attachments.md) / [검증 근거](docs/validation/rich-attachments.json)
- [통합 멘션·좌장 기본 라우팅 명세](docs/mention-routing.html) / [원문](docs/design/0006-mention-routing.md)
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
