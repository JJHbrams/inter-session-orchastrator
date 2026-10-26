# Inter Session Orchestrator

Windows에서 기존 Codex·Claude 작업 세션을 채널과 토론 단위로 모아 협업하는 개인용 앱.

현재 단계는 **로컬 브라우저 실행판 / 전체 명세 building**이다. 채널·참여자·공동 대화·별칭 멘션·반응, SQLite outbox/writer/fence, scoped HTTP/stdio MCP를 구현했다.

**별도 좌장 만들기**로 초대된 참여자와 다른 앱 소유 Claude 또는 Codex 대화를 만든다. 좌장도 **@별칭**으로 직접 지정한다. 멘션 없는 질문은 좌장이 먼저 받아 내용과 참여자 설명을 보고 필요한 대상에게 위임하거나 직접 답한다. 같은 native ID로 질문·취합하며, 좌장의 발화·참여자 질문·미확정 결정도 공용 대화에 남는다. 별도 좌장과 두 검증용 provider의 질문/응답/자동 취합, 재시작 후 동일 ID 답변을 확인했다.

서버 재시작 시 열린 화면은 자동 재인증하고 초안을 보존한다. 서로 다른 포트의 쿠키를 분리하며 네트워크 단절 시 접수 불명 메시지는 자동 재전송하지 않는다. 앱은 창 전체 폭을 사용하고 메시지 버블만 최대720px로 제한한다. 사용자 버블은 오른쪽, 참여자 버블은 왼쪽, 좌장 버블은 중앙이다. 상단은 좌장·토론 정리와 참여 세션의 두 행으로 나뉘며 프로필에는 provider 아이콘을 표시한다.

경계의 손잡이를 드래그하거나 방향키로 사이드바·입력창·세션 상세 크기를 조절한다. 좌장 프로필·정리·참여자 행은 화면에 맞춰 자동 배치한다. 크기는 브라우저에 저장하며 **배치 초기화**로 복원한다. **크게 보기**로 긴 정리를 펼치고, 채널 또는 토론장 제목 옆 **이름 변경**으로 기록과 ID를 유지한 채 이름을 바꾼다. Provider 아이콘은 흰 배경 배지다. 오른쪽 말풍선 안에서도 프로필은 왼쪽에 표시한다.

대화와 좌장 정리는 Markdown과 정적 HTML 서식을 표시한다. 스크립트·이벤트·스타일·프레임은 제거하고 외부 이미지는 자동 로드하지 않는다. 파일 선택·작성란 drop·이미지 클립보드 붙여넣기로 최대5개, 각10MiB를 공유한다. 이미지 미리보기와 원본 다운로드, room별 초안·제거·재시도를 제공한다. 별도 좌장은 지원 이미지와 UTF-8 텍스트 내용을 직접 입력받으며 PDF·Office 등의 자동 파서는 아직 없다.

## 실행

Node 24.14.1에서 검증했다. marked·DOMPurify는 고정 버전으로 로컬 제공한다. 내장 SQLite는 experimental 경고가 표시된다.

```powershell
npm ci
npm start
```

[로컬 앱 열기](http://127.0.0.1:4318/). 데이터는 Git에서 제외된 `.local/rooms.sqlite`에 저장한다. `PORT`와 `ROOMS_DB`로 실행 위치를 조정할 수 있다. Orca discovery·출력 조회는 실행 프로세스가 Orca 로컬 IPC에 접근할 수 있어야 한다.

토론장을 만들면 세션 카탈로그가 열린다. Codex의 native state/index, Claude의 native sessions-index 및 최근 JSONL 메타데이터에서 provider·제목/요약·native ID·작업 폴더를 검색해 고른다. 요약이 없으면 첫 입력 미리보기를 사용하며, 제한된 최근 이력 목록이므로 전체 보관함을 뜻하지 않는다. **직접 등록**으로 provider·ID·폴더를 명시할 수도 있다. 이력 조회와 현재 터미널 연결은 별개이며, 자동 전달하려면 정확한 실행 터미널을 확인하고 허용 범위를 선택한다.

**자동 입력 전달 허용**을 켠 참여자는 Orca의 idle 및 빈 입력창 확인 뒤 자동으로 깨워 요청을 받는다. 접수 영수증과 실행 시작을 구분하고, 원래 request ID에 인증된 `room_reply`가 도착해야 완료로 표시한다. **응답 재호출**은 먼저 기존 결과를 대조하며, 필요한 경우 같은 요청의 답변 제출만 다시 안내한다. 이미 완료된 응답은 재실행하지 않는다. busy·초안·해석할 수 없는 입력창은 이유를 표시하며 대기한다. 전송 직전 재확인은 하지만 Orca가 원자적 초안 잠금을 제공하지 않으므로 동시 사용자 타이핑 경쟁을 완전히 제거하는 것은 아니다.

토론장 생성 또는 **작업 공간**에서 실제 폴더를 지정한다. `<cwd>/.session-rooms/<room-id>/`에 대화 원문 `transcript.md`, 제안/사용자 확정을 구분한 `consensus.md`, 근거와 첨부 목록 `manifest.json`, 첨부 원본을 자동 저장한다. 새 좌장은 그 cwd에서 시작하고 기존 좌장은 원래 native 대화 cwd를 유지하며 방의 작업공간 정보를 전달받는다. 일반 폴더 자료의 자동 수집·PDF/Office 해석은 후속이다.

## MCP와 참여자

토론 한도는 **사용자 요청별 자동 대화 루프**에 적용한다. 병렬 질문은 한 라운드로 세고, 한도에 도달하면 추가 자동 질문만 멈춘다. 응답은 보존하고 다음 사용자 입력은 별도 한도로 진행한다. 과거 한도 초과로 저장 결과가 남은 미확인 실행은 모델 재호출 없이 복구한다.

좌측 목록의 채널·토론장을 우클릭하고 **이름 변경**을 선택해 개별 수정한다. 키보드는 항목에 포커스를 두고 **Shift+F10** 또는 메뉴 키로 연다. `#`은 실제 채널 제목에만 붙이고 토론장 이름과 ‘채널 없음’에는 붙이지 않는다. 동일한 등록 세션 ID의 별칭·색상은 다른 채널의 토론장에도 유지한다.

같은 컨텍스트 메뉴에서 **보관/복원**한다. 채널은 하위 토론장이 모두 보관돼야 보관할 수 있다. 보관된 채널·토론장은 기본 숨김이고 왼쪽 아래 **보관 항목 표시**로 확인한다. 방을 복원하면 보관된 상위 채널도 복원하며, 채널만 복원하면 하위 방의 보관 상태는 유지한다.

세션 선택창은 검색·provider 필터와 짧은 목록, 선택 상세로 구성한다. 방향키·Enter로 선택하며 ID·작업 폴더를 확인한 뒤 초대한다. native subagent·SAO worker·앱 전용 좌장은 기본 제외한다. **작업용 세션 포함** 또는 정확한 native ID 검색으로 명시적으로 찾을 수 있다. 상단은 초대·좌장·작업공간을 우선 표시하고 한도·중지·보관·배치 초기화는 **더 보기**로 묶는다.

카탈로그는 **전체 작업공간**의 최근 이력이며 현재 토론장cwd로 제한하지 않는다. **검색 지우기**로 프로젝트 검색을 해제한다. 입력창 초안·연결·대기 상태를 확인하지 못해 전송하지 않은 요청은 카드·메시지·상세에서 **전달 차단**과 사유를 표시한다. **상태 다시 확인**은 새 요청을 만들지 않고 전달 조건을 재검사하며, 준비되면 기존 요청을 전달한다.

Orca가 빈 입력란의 추천 문구 등을 초안으로 보고할 수 있다. 실제 입력란이 비어 있는데 차단되면 **상태 다시 확인 → 입력란이 비어 있음 · 이번 요청 전달**로 원래 요청 한 건을 복구한다. 확인은 현재 요청·연결·화면에 묶이고 60초 뒤 만료되며 한 번만 사용한다. 자동 감지 오탐 자체가 해결된 것은 아니다.

입력창에서 **Enter는 전송**, **Shift+Enter는 줄바꿈**이다. 멘션 후보가 열려 있으면 Enter는 후보를 선택하며, 한글 조합 중 Enter는 전송하지 않는다.

`@to_all`은 좌장·이탈자·읽기 전용을 제외한 현재 참여자 모두에게 직접 질문한다. 멘션 후보와 파란 강조를 지원하며 전송 전 실제 수신자를 보여준다. 개별 멘션과 겹쳐도 한 번만 전달하고, 좌장도 명시적으로 멘션했을 때만 좌장을 추가한다. 잘못된 개별 멘션을 섞거나 수신자가 없으면 전송을 차단한다.

**좌장 만들기**에서 Claude/Codex와 모델·effort를 선택한다. 생성한 뒤에는 **좌장 설정** 또는 좌장 카드 아래 **모델 · effort 설정**에서 변경한다. Provider와 대화 ID는 고정하고 진행 중 응답은 기존 설정으로 마치며, 다음 실행부터 새 모델·effort를 사용한다. CLI 기본 모델을 선택하면 해당 CLI 기본 effort를 함께 사용한다. 직접 모델 ID 입력은 provider가 허용할 때 제공하며, 지원 effort를 확인할 수 없는 모델은 기본 effort를 사용한다.

**더 보기 → 자동 대화 설정**은 사용자 입력 한 번을 기준으로 **한 번만 / 최대 3차례 / 최대 6차례 / 직접 정하기**를 제공한다. 한 차례는 좌장의 질문과 참여자의 답변이며, 여러 대상에게 동시에 질문해도 한 차례다. 병렬 질문과 좌장 취합을 합산하는 메시지 전달 상한은 고급 설정에서 따로 조절한다. 두 한도 중 먼저 도달한 한도가 추가 자동 질문을 멈추며, 다음 사용자 입력은 새 한도로 시작한다.

참여 세션에는 지속되는 랜덤 별칭과 색상 프로필이 배정된다. `@이름`으로 좌장 또는 참여자 한 명·여러 명에게 직접 질문하며, 후보는 방향키·Enter·Tab으로 선택한다. 별도 수신 모드 버튼은 없다. 전송 전에 직접 수신자 또는 기본 좌장을 미리 보여주고 모르는 별칭·작성 중인 `@`·읽기 전용 대상은 차단한다. 멘션 없는 질문은 전용 좌장 한 명이 먼저 받으며, 좌장이 없거나 이전 실행 확인이 필요하면 차단한다. 게시·알림 모드와 이모지 반응은 실행 요청을 만들지 않는다.

참석자 카드와 발언에는 동일 프로필·별칭을, provider는 보조 배지로 표시한다. 생성 테두리는 실제 저장된 running 상태에서만 켜진다. 기본 반응은 **👍 좋아요 → 👎 반대 → ❓ 모르겠음 → ✅ 확인(알았음) → 💡 아이디어 있음** 순서다. 숫자를 누르면 반응자 이름·프로필·provider가 보이고, 내 반응만 독립적으로 추가·취소한다. 기존 ❤️·👀 기록은 남는다.

참여 agent는 `room_react`로 본인 신원의 반응을 남기고, 좌장도 구조화 응답으로 반응한다. 자신이 쓴 발언의 반응은 다음 입력의 `reactionFeedback`에 원문·반응자·의미와 함께 포함된다. 💡는 설명되지 않은 아이디어를 해당 반응자에게 물어볼 신호이고, ❓·👎는 어려운 지점·반대 이유를 확인할 신호다. ✅는 수신/이해 확인이며 승인이나 작업 완료가 아니다. 반응만으로 새 실행을 만들지 않으며, 기존 참여자는 MCP inbox를 읽어야 피드백을 받는다.

`packages/mcp/server.js`는 stdio JSON-RPC MCP 서버다. 실행 환경의 `ROOMS_URL=http://127.0.0.1:4318`과 `ROOMS_TOKEN`으로 선택한 room registration을 전달한다. 토큰은 명령 인자·Git·공유 프롬프트에 넣지 않는다. 도구는 `room_context`, `room_post`, `room_request`, `room_reply`, `room_inbox`, `room_result`, `room_react`, `room_upload_attachment`, `room_read_attachment`다. 자동 전달은 사용 가능한 native room MCP를 우선 사용하고, 없으면 비공개 `.local` 설정을 사용하는 HTTP helper를 안내한다. 실행 허용 여부는 원래 provider 정책을 따른다.

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

API는 loopback·Host/Origin·CSRF·HttpOnly SameSite 쿠키와 room 등록으로 범위를 제한한다. 동일 Windows 사용자 프로세스는 신뢰 경계 안에 있다. 별도 좌장은 설치된 Claude CLI를 도구·MCP·프로젝트 훅 없이 실행한다. 실행 파일은 CLAUDE_CHAIR_COMMAND로 지정할 수 있다. 이미 생성된 좌장은 정확한 ID만 resume하며, 초기화 실패 때 새 ID로 조용히 대체하지 않는다. 초기화 자체의 재시도 UI, 설치형 shell, 일반 참여자 new/resume/fork는 후속이다.

## 검증과 문서

```powershell
npm test
```

현재147개 테스트가 통과했다. 안건별 좌장 계획→두 provider 실제 파일 조사→상호 검토→최종 qualified 결과→승인 ACK 2/2를 확인했다. Orca 추천문구의 draft 오탐과 Codex 붙여넣기 제출에는 복구 조작이 필요해 전체 무인 전달은 미완료다. 기존124개 검증에서는  실제 opt-in Codex·Claude 자동 응답, 중단된 Claude 답변의 같은 요청 ID 재호출, 별도 좌장의 질문→두 provider 응답→출처가 있는 미확정 제안을 확인했다. Claude canary는 해당 프로세스에서만 room 전용 native MCP와 빈 도구 목록을 사용했고 프롬프트 제안을 껐다. 기존 Claude ‘수아’는 실제 입력란이 비어 있다는 사용자 확인에 따라 원래 요청3건을 같은 ID로 복구했고 인증된 답변을 모두 회수했다. Orca의 draft 보고를 실제 작성 중 입력으로 단정하지 않는다. 자동 전달 검증은 모든 CLI 버전이나 임의의 기존 세션에 대한 무조건적 지원을 뜻하지 않는다.

첨부 권한·멱등·재시작·원본 바이트, HTTP/stdio/helper, Markdown 정제와 초안 경계, 패널 호환·멘션 목록 배치를 검증했다. 실제 브라우저의 파일 선택·클립보드·drop·재시도와 새 좌장의 이미지/텍스트 판독을 확인했다. 인식된 @별칭은 입력창과 대화에서 파란 배경으로 강조한다. 멘션 목록은 패널 밖으로 펼쳐지며, 3개 CSS viewport에서 후보 노출과 재배치를 확인했다. OS 물리 드래그와 원래 V-01~V-13 전체는 별도 미검증이다.

- [자동 전달·재호출·카탈로그·작업공간 실제 검증](docs/validation/participant-delivery.json)
- [채널 보관·세션 선택 UX 조사와 구현](docs/catalog-archive.html) / [명세 원문](docs/design/0007-catalog-archive.md) / [검증 근거](docs/validation/catalog-archive.json)
- [좌장 provider·모델 설정과 자동 대화 한도](docs/chair-provider-settings.html) / [명세 원문](docs/design/0008-chair-provider-settings.md) / [검증 근거](docs/validation/chair-provider-settings.json)
- [입력란 확인 후 초안 감지 차단 복구](docs/composer-recovery.html) / [명세 원문](docs/design/0009-composer-recovery.md) / [검증 근거](docs/validation/composer-recovery.json)
- [안건별 자율 토론·채널 → 토론장 지식 위키](docs/agenda-deliberation.html) / [명세](docs/design/0010-agenda-deliberation.md) — 핵심 구현·실제 두 provider 검증, 자동 입력 제한은 [검증 근거](docs/validation/agenda-deliberation.json) 참조. 기본 자료 루트는 `D:\inter_session_debate`, 앱 설정에서 변경 가능. 로컬 위키 진입점은 해당 루트의 `wiki/index.md`다.

- [채널별 토론장 접기·펼치기](docs/channel-tree.html) / [명세](docs/design/0011-channel-tree.md) / [실제 UI 검증](docs/validation/channel-tree.json) — 채널 제목 클릭 또는 Enter·Space로 목록을 접고 펼친다. 펼침 상태는 현재 브라우저에 저장되며 열린 대화와 초안은 유지한다.
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

검증 모델의 HTTP helper 사용, room 전용 native MCP와 별도 stdio 프로토콜 검증은 근거에서 구분했다. 전역 provider 설정은 변경하지 않았다.
