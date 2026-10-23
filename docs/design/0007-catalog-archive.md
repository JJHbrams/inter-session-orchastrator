---
id: 0007-catalog-archive
title: 채널 보관과 세션 선택 UX
tier: L
status: done
owner: jhjang
created: 2026-10-23
updated: 2026-10-23
---

<!-- sr:plan
{"document_type":"decision","reader_questions":["무엇이 바뀌는가","왜 목록을 바꾸는가","보관과 복원은 어떤 범위인가","검증 결과는 무엇인가"],"visual_plan":[{"kind":"decision_matrix","content":"제품별 목록 패턴과 채택 결정","required":true},{"kind":"flowchart","content":"보관 전제와 복원 흐름","required":true},{"kind":"state_diagram","content":"채널과 토론장의 보관 상태","required":true},{"kind":"sequence_diagram","content":"보관 API의 원자적 검증","required":true},{"kind":"er_diagram","content":"채널과 토론장 관계","required":true}],"visual_waiver":[]}
-->

# 채널 보관과 세션 선택 UX

> 보관 항목을 기본 화면에서 숨기고, 초대할 실제 작업 세션을 짧은 목록과 선택 상세로 찾는다.

## 한눈에 보기

- 목적: 채널 보관의 전제를 지키면서 목록의 잡음과 공간 낭비를 줄인다.
- 현재 상태: 구현·브라우저 검증을 마치고4318에 적용했다. 최신 후속 수정의 전체 테스트109/109, 기존38발언 원문 보존을 확인했다. 원래 Claude의 실제 응답 회수는 Orca 초안 상태 정리 전까지 미확인이다(§12~13).
- 핵심 결론: 보관은 삭제와 분리하고, 기본 목록은 활성 항목·주 작업 세션 중심으로 표시한다.
- 원인 또는 판단 근거: 변경 전 카탈로그는 모든 정보와 버튼을 항목마다 반복했다. 현재는 높이 약66px의 행과 선택 상세를 분리하고 채널 보관 필드를 추가했다.
- 결정: 검색 가능한 짧은 행과 선택 상세, 명시적인 보관 표시 토글, 주요 작업과 보조 작업이 구분된 상단바를 적용한다.
- 다음 행동: 4318에서 보관 표시 토글과 세션 선택창을 사용한다. 전체 host 검증 V01~13과 일반 참여자 lifecycle은 별도 후속 범위다.
- 최종 갱신: 2026-10-23, Asia/Seoul.

## 1. 의도 (Intent)

사용자는 채널을 하위 토론장 전체 보관 후에만 보관하며, 보관된 채널과 토론장은 토글로 확인한다. provider subagent와 SAO 하위 실행 세션을 일반 초대 목록에서 제외한다. 기존 native ID·별칭·메시지·자료·프로세스와 권한 정책을 보존한다. 전체 provider lifecycle 재설계는 이번 범위 밖이다.

## 2. 수용 기준 (Acceptance)

| ID | 사용자 결과 | 검증 방법 |
|---|---|---|
| AC-1 | 활성 하위 토론장이 남으면 채널 보관을 거부하고 모두 보관됐으면 허용한다. | storage/API 혼합·전체·빈 채널 및 실제 브라우저 전후 |
| AC-2 | 보관 채널·토론장은 기본 숨김이며 보관 표시 토글로 함께 확인한다. | 브라우저 기본/켜짐/꺼짐, 재열기 |
| AC-3 | 복원은 기록을 보존한다. 토론장 복원은 상위 채널도 복원하고, 채널만 복원하면 하위 토론장은 보관 상태를 유지한다. | 트랜잭션·재열기·원문 비교, 실제 복원 |
| AC-4 | 보관된 채널에 활성 토론장이 생기지 않는다. 새 토론장은 거부하고 복원은 상위 채널과 원자 처리한다. | API 우회·실패 rollback 테스트 |
| AC-5 | 일반 세션은 유지하고 provider child·SAO worker는 기본 제외한다. 정확한 ID 조회·명시적 포함은 가능하다. | 실제 native metadata 관측과 positive/negative fixture, 카탈로그 UI |
| AC-6 | 선택 목록은 짧은 행/상세 분리와 키보드 탐색을 지원하고, 상단바는 주요/보조 작업을 구분한다. 숨긴 보관 항목이 선택 상태로 남지 않는다. | 1440×900·1280×800 시각 QA, 검색·선택·전환·숨김 경로 |

## 3. 확정 사실 (Facts)

| 구분 | 관측과 근거 | 적용 |
|---|---|---|
| 로컬 구현 | channels.archived_at additive migration, 보관 전제와 복원 트랜잭션을 구현했다. 104개 테스트와 실제 UI/API 경로를 확인했다(2026-10-23). | 서버에서 활성 하위 방이 있으면409 및 개수 반환 |
| 로컬 UI | 짧은 행·단일 선택 상세와 provider 필터를 구현했다. CSS viewport1440×900·1280×800에서 행 약66px, 전체 대화상자와 ID 노출을 확인했다. | [1440 화면](../screenshots/session-picker-1440.png), [1280 화면](../screenshots/session-picker-1280.png) |
| 내부 세션 | Codex native subagent/guardian_review와 구조화 source, Claude sidechain/subagent 표식을 분류한다. 설치된 SAO의 정확한 첫 입력 wrapper와 앱 전용 좌장 초기화 문구도 제외한다. | 제목의 SAO 단어만으로 제외하지 않는다. 정확한 UUID 검색·작업용 포함 옵션 및 등록된 borrowed 세션은 명시적으로 접근 가능하다. |
| VS Code | Quick Pick은 검색, 구별에 필요한 아이콘/description, 짧은 detail, 분류 separator와 관련 항목 다중 선택을 안내한다. [공식 지침](https://code.visualstudio.com/api/ux-guidelines/quick-picks), 확인 2026-10-23. | 검색을 상단 고정하고 provider 아이콘·제목·프로젝트 행을 사용한다. 상세는 선택 후 펼친다. |
| Linear | 빠른 검색과 최근 항목, 검색 필터를 제공한다. [공식 검색 문서](https://linear.app/docs/search), 확인 2026-10-23. | 기본 최근 갱신 순서와 provider 필터, 키보드 탐색을 적용한다. |
| Slack | 보관과 삭제를 분리하며 보관 채널 필터에서 찾고 복원한다. [공식 보관 문서](https://slack.com/help/articles/213185307-Archive-or-delete-a-channel), 확인 2026-10-23. | 별도 삭제 대신 보관 토글과 복원 작업을 둔다. 하위 전체 보관 전제는 이 앱 사용자 요구다. |

제품의 문서 패턴을 조사한 것으로 로그인한 실제 계정의 전체 동작 실험은 아니다. 우리 앱에서의 밀도·가독성은 로컬 브라우저로 별도 검증한다.

세션 요약은 native 제목·요약 또는 첫 입력 미리보기이며 새 LLM 요약을 생성하지 않는다. 이력은 실제 실행 터미널과 별개다. 알려진 native 표식과 정확한 wrapper를 분류하므로 다른 도구의 미등록 worker 형식은 남을 수 있다. 현재 프로젝트 검색에서 기본4개·작업용 포함80개(상한)를 관측했다.

### 선택지

기존 전체 카드, 짧은 목록만 표시, 검색 목록과 선택 상세의 세 방식을 비교했다.

### 비교

| 대안 | 목록 밀도 | 식별 정보 | 키보드 | 결정 |
|---|---|---|---|---|
| 기존 모든 정보 카드 | 낮음 | 전부 반복 | 버튼 순회 | 교체 |
| 짧은 목록만 | 높음 | 긴 원래 ID와 요약을 보기 어려움 | 가능 | 단독 사용 안 함 |
| 검색 목록과 선택 상세 | 높음 | 선택한 정보 전체 확인 | 방향키·Enter | 채택 |

### 평가기준

한 화면에 보이는 목록 밀도, provider·ID·cwd의 식별 가능성, 키보드 조작, 보관 전제와 기록 보존으로 판단한다. native 이력과 현재 실행 연결은 구분해서 표시한다.

### 결정

검색·provider 필터·짧은 행과 선택 상세를 채택한다. 보관 항목은 기본 숨기고 토글로 표시한다. 빈번한 상단 작업은 남기고 한도·중지·보관·배치 초기화는 더 보기로 묶는다.

## 4. 유스케이스 (Use Cases)

```mermaid
flowchart LR
 U[사용자] --> A[토론장 보관]
 A --> C[모든 하위 보관 확인]
 C --> H[채널 보관]
 U --> T[보관 표시 토글]
 T --> R[기록 확인 또는 복원]
 U --> S[작업 세션 검색]
 S --> P[짧은 행 선택 및 상세 확인]
 P --> I[기존 연결 확인 후 초대]
```

## 5. 구조와 처리 흐름 (Flow)

```mermaid
flowchart TD
 A[채널 보관 요청] --> B{활성 하위 토론장 존재}
 B -->|있음| E[이유와 남은 개수 표시]
 B -->|없음| C[채널 보관 저장]
 C --> D[기본 목록에서 숨김]
 R[토론장 복원] --> P[같은 트랜잭션에서 상위 채널 복원]
 P --> Q[해당 토론장만 복원]
```

목록 API는 전체 항목을 유지하고 UI가 보관 표시를 적용한다. 서버는 UI 필터와 무관하게 보관 전제를 검증한다. 카탈로그의 작업용 세션 분류는 native 메타데이터를 우선하고, 추론 규칙은 좁은 실행 wrapper로 제한한다.

## 6. 상태 전이 (State)

```mermaid
stateDiagram-v2
 Active --> RoomsArchived: 모든 하위 토론장 보관
 RoomsArchived --> ChannelArchived: 채널 보관
 ChannelArchived --> RoomsArchived: 채널만 복원
 ChannelArchived --> Active: 토론장 복원과 상위 복원
 RoomsArchived --> Active: 특정 토론장 복원
```

| 상태 | 저장 | UI |
|---|---|---|
| 활성 | archived_at 없음 | 기본 표시·새 입력 가능 |
| 토론장 보관 | room.archived_at | 기본 숨김·보관 토글에서 읽기 |
| 채널 보관 | channel.archived_at 및 모든 room.archived_at | 기본 숨김·보관 토글에서 복원 |

## 7. 타이밍 (Timing)

```mermaid
sequenceDiagram
 participant U as 사용자
 participant API as 서버
 participant DB as SQLite
 U->>API: 채널 보관
 API->>DB: transaction 시작 및 활성 하위 조회
 alt 활성 하위 있음
 DB-->>API: 남은 개수
 API-->>U: 보관 거부
 else 모두 보관됨
 API->>DB: archived_at 저장 및 commit
 API-->>U: 성공 후 목록 갱신
 end
```

## 8. 데이터 (ER)

```mermaid
erDiagram
 CHANNEL ||--o{ ROOM : contains
 ROOM ||--o{ MESSAGE : preserves
 ROOM ||--o{ MEMBERSHIP : preserves
 CHANNEL { string id string archived_at }
 ROOM { string id string channel_id string archived_at }
```

## 9. 변경 지점 (Change Surface)

| 경로 | 변경 |
|---|---|
| `services/coordinator/store.js`, `services/coordinator/server.js` | 채널 migration·보관/복원 조건과 API |
| `adapters/catalog/index.js` | native child/worker 분류와 명시적 포함 |
| `apps/desktop/app.js`, `apps/desktop/index.html`, `apps/desktop/style.css` | 보관 토글·컨텍스트 메뉴·선택 UI·상단바 |
| `tests/` | 저장/HTTP/catalog 경계 검증 |

## 10. 잠재 문제 (Risks)

| 위험 | 대응 |
|---|---|
| 제목에 SAO를 언급한 일반 사용자 세션 누락 | 제목 단어만으로 제외하지 않고 native source 및 좁은 wrapper 표식 사용 |
| 숨긴 보관 항목이 계속 선택됨 | 표시 전환과 보관 직후 보이는 방을 재선택하거나 빈 상태로 이동 |
| 채널 보관 뒤 토론장 생성 우회 | 서버 transaction 안에서 전제 검사 |
| 선택 창이 긴 원문 때문에 커짐 | 행은 말줄임, 상세만 스크롤, 창은 viewport 안으로 제한 |

## 11. 착수 순서 (Slices)

- [x] 채널 보관과 원자적 복원·API — AC-1, AC-3, AC-4.
- [x] 보관 표시와 선택 상태·복원 UI — AC-2, AC-6.
- [x] native child/SAO worker 분류 — AC-5.
- [x] 검색 목록·선택 상세·상단바와 실제 브라우저 검증 — AC-6.

## 12. 추적성 (Traceability)

### 결과

| 기준 | 결과 | 근거 |
|---|---|---|
| AC-1 | PASS | 활성 하위 방의 UI 비활성·API409, 전체 보관 후 채널 보관 성공 |
| AC-2 | PASS | 기본 숨김·토글 표시·보관 배지·선택 항목 숨김 시 대체/빈 상태 |
| AC-3 | PASS | 채널만 복원하면 자식 보관 유지, 방 복원 시 상위도 복원. 배포 전 기존37건의 id/body/request_key/payload_hash/reply_to/created_at을 재대조해 동일함 |
| AC-4 | PASS | 보관 채널에 생성 거부, 복원 실패 rollback. 실제 DB의 보관 부모 아래 활성 방0개 |
| AC-5 | PASS | native positive/negative fixture, 정확한 ID 검색, 포함 옵션4→80, provider 필터2개 모두 Codex |
| AC-6 | PASS | 두 viewport에서 대화상자·ID 노출, 방향키/Enter로 원래 ID·cwd 유지한 초대 폼 진입. 상단 보조 작업은 더 보기로 이동 |

전체 `npm test` 104/104, `node --check apps/desktop/app.js` 통과. [검증 JSON](../validation/catalog-archive.json)과 [상단 더 보기 화면](../screenshots/archive-toolbar-1280.png)을 함께 보관한다. 별도 토론장/DB에서 UI 경로를 검증했고 테스트 질문이나 초대를 기존 작업 세션에 보내지 않았다. 신선한 독립 검토에서도 AC-1~6이 모두 PASS였다.

기준 revision은 f8bde4e다. 채널 backend066a2e4와 catalog577e42f·c0d074a를 현재 feat/archive-session-picker 브랜치에 통합했다. 실행판은 http://127.0.0.1:4318/ 이며 기존37발언을 보존했다. 이 결과는 이번6개 수용 기준의 완료이고 원래 전체 host V01~13 완료를 뜻하지 않는다.

### 재검토 조건

provider가 native 이력 형식을 바꾸거나 알려지지 않은 worker가 기본 목록에 보이면 fixture와 분류 규칙을 갱신한다. 긴 한국어 제목·작업 경로로 실사용 선택이 어려워지면 상세의 줄 수와 비율을 다시 조정한다.

## 13. 카탈로그 범위와 전달 차단 후속 수정

사용자는 다른 프로젝트 세션이 보이지 않는 듯한 현상과, Claude가 응답하지 않으면서 '요청 대기'로 표시되는 문제를 보고했다.

| 확인 항목 | 직접 관측 | 조치 |
|---|---|---|
| 카탈로그 기본 범위 | 검색어 없는 native 조회와4318 UI는80개 결과·17개 서로 다른cwd 및cwd 미확인 항목을 반환한다. 현재 프로젝트로 제한하는 요청 파라미터는 없다. 직전 QA 화면에는 프로젝트 이름 검색어가 들어 있었다. | 전체 작업공간 범위와 검색 해제를 명시한다. 검색·provider 필터·최근 순서는 유지한다. |
| Claude 연결 | 등록한 handle·incarnation이 일치하고 connected/writable=true다. 원래 대기 요청3건은queued이며 전송 전 차단됐다. | 프로세스 종료로 단정하지 않는다. 차단 사유를 카드·타임라인·상세에 표시한다. |
| Claude 입력란 문구 | Orca `terminal read --screen`은 판독한 문구를draft에 따로 반환하며tail에서는 제외한다. 반환 정보에 셀의dim 스타일은 없다. | draft 보고만으로 사용자가 작성한 초안이라고 단정하지 않는다. 자동 전달은 보류하고 정확한 감지 사유를 표시한다. |
| 정상 Claude footer | 실제 화면의 `bypass permissions on (shift+tab to cycle)`을 기존 판독기는 허용하지 않았다. | 알려진 표시 형식을 추가하되 권한 설정을 변경하지 않는다. 초안·작업 중·불명 화면은 계속 거부한다. |
| 상태 표시 | queued에blocked_reason이 있어도 '요청 대기'로 표시했다. | 저장된queued와 재확인 스케줄은 유지하고, 사용자에게 '전달 차단' 및 이유·해결 방법을 표시한다. |

후속 수정은4318에 적용했다. 전체109개 테스트와 실제 UI에서 기본80개→프로젝트 검색4개→검색 지우기80개를 확인했다. 참여자 카드·타임라인3건·세션 상세 모두 '전달 차단'과 초안 사유를 표시한다. 수정 전 기존38발언도 동일하게 유지됐다. [후속 검증 JSON](../validation/catalog-delivery.json), [전체 범위 화면](../screenshots/catalog-global-scope.png), [차단 표시 화면](../screenshots/claude-delivery-blocked.png)을 보관한다.

감지된 문구는 사용자 요청에 따라 비공개 백업했다. 일반 편집 입력은 문구를 지우지 못했다. 사용자에게 수동으로 지우라는 안내는 철회했고, 사용자가 직접 복구를 재승인했다. 기존 요청3건의 실제 Claude 응답 회수는 아직 **UNVERIFIED**다.

설치된 Orca 코드를 추적하면draft는 별도 저장소가 아니라 터미널 커서 문맥에서 판독한 결과다. 다만dim 셀을 제외한afterCursor가 비면rawAfterCursor로 되돌아가며, 일부 고정 placeholder만 제외한다. 따라서 임의의 흐린 추천 문구를 실제 초안으로 오인할 수 있는 경로가 있다. 현재 한국어 문구가 실제로dim인지 CLI 응답만으로 확정할 수는 없다. [Claude 공식 문서](https://code.claude.com/docs/en/interactive-mode#prompt-suggestions)도 다음 질문 추천은Tab/오른쪽키로 작성란에 넣고, 타이핑하면 숨겨진다고 설명한다.

근거는 설치된Orca `out/shared/terminal-cursor-line-context.js`, `terminal-composer-draft.js` 및 `out/main/index.js`의readRenderedScreen·Rir/a8·Iir/Fir 경로다. 자동 전달을 위해 이 불명 문구를 무조건 무시하지 않으며 권한 설정도 변경하지 않는다. 다른 프로젝트 세션으로 테스트 입력을 보내지 않았다.

## 참고

- [[session-room-foundation]], [[inter-session-index]]
- [VS Code Quick Picks](https://code.visualstudio.com/api/ux-guidelines/quick-picks)
- [Linear Search](https://linear.app/docs/search)
- [Slack Archive](https://slack.com/help/articles/213185307-Archive-or-delete-a-channel)

