<!-- sr:plan
{"document_type":"research","reader_questions":["어떤 버전을 조사했는가","원자료와 근거는 어디 있는가","검증 수준은 무엇인가","다시 조사하려면 무엇을 보면 되는가"],"visual_plan":[{"kind":"comparison_table","content":"제품별 revision과 수집 범위 비교","required":true},{"kind":"flowchart","content":"원자료에서 분석보고서로 이어지는 근거 경로","required":true}],"visual_waiver":[]}
-->

# 벤치마킹 자료 목록과 검증 범위

> 조사 원자료·커밋·분석·미실험 범위를 연결하는 재현용 인덱스. 2026-10-22.

## 한눈에 보기

- 목적: 후속 구현자가 확인하지 않은 가정을 제품 기능으로 오인하지 않도록 근거를 보존한다.
- 현재 상태: 제품 4종의 고정 source archive, OpenClaw 선택 소스 9개, Orca 설치 가이드, NotebookLM 파일 hash를 수집했다.
- 핵심 결론: README·정적 소스·로컬 관측·실제 실행은 서로 다른 증거 수준이다. 이번 완료 범위는 수집과 선택 경로 정적 분석이다.
- 원인 또는 판단 근거: source-manifest.json 및 claim-ledger.json의 고정 revision·파일·행으로 추적할 수 있다.
- 결정: 원자료와 제품별 조사 노트, 종합분석 및 후속 검증 계획을 나누어 저장한다.
- 다음 행동: [[benchmark-analysis]]를 읽고 [[benchmark-validation-plan]]의 미실행 항목을 다음 작업 범위로 삼는다.
- 최종 갱신: 2026-10-22, Asia/Seoul.

## 질문

무엇을 어느 버전에서 읽었고, 어떤 결론이 실제 실행으로 확인된 것인가.

## 짧은 답

제품의 최신 branch HEAD를 수집 시점에 SHA로 고정했다. latest release 태그는 별도로 기록했고 HEAD와 같다고 가정하지 않았다. 외부 제품은 설치·실행하지 않았고 현재 사용자의 작업 세션에도 입력하지 않았다.

## 근거

아래 수집 범위·revision·hash의 출처는 로컬 evidence manifest다. 분석 claim은 고정된 소스 파일과 행 번호로 다시 확인할 수 있다.

### 고정 자료 목록

| 자료 | 고정 revision 또는 관측 식별자 | 범위 | 연결 문서 |
|---|---|---|---|
| magents | 0dd29e28f8170150b0135d93e55ee1d3b8ffa45a | archive 파일 101개, 핵심 전달·mailbox·재개 경로 정적 검토 | [[magents-benchmark]] |
| agent-intercom | 610cc64f489cba940bab27ff88d0e5f77c004359 | archive 파일 59개, mailbox·push·설치·socket 경로 | [[intercom-benchmark]] |
| agentmux | 3d4244dd7f69254b379814d8bc1231f42c4d93ae | archive 파일 1536개, queue·fence·native identity·권한 경로 선택 검토 | [[agentmux-benchmark]] |
| Orchestra | 50ecf08e96be01c03eb3ee0e4a686d0dfe84b0c5 | archive 파일 278개, collaboration·host·메시지 UI 경로 | [[orchestra-benchmark]] |
| OpenClaw | d920bfc80fe14a6fac9a0019fc7887da66dfa189 | 선택 파일 9개만 수집, 전체 runtime 감사 아님 | [[host-reference-benchmark]] |
| Orca | ProductVersion 1.4.229 | 설치 CLI의 가이드 3개와 binary version metadata | [[host-reference-benchmark]] |
| NotebookLM | HEAD fc60ae3531f95fee914ca715ff882f540bf6abae 및 파일별 hash | 실제 worktree 파일 7개, HEAD와 동일하다고 가정하지 않음 | [[host-reference-benchmark]] |

파일 수는 archive 수집 범위이며 전 파일을 분석했다는 뜻이 아니다. 수치의 근거는 source-manifest.json의 file_count다.

### Release와 source HEAD의 차이

| 제품 | latest release API 응답 | 주의 |
|---|---|---|
| magents | 0.14.2 | 조사한 HEAD와 release 내용은 별도 |
| agent-intercom | v0.2.5 | release asset 유무와 npm 배포/실동작을 혼동하지 않음 |
| agentmux | agentmux-link-v1.2.24, Android APK | 조율 runtime의 release 검증 근거로 사용하지 않음 |
| Orchestra | v0.9.0, macOS/Linux asset | Windows 설치본 존재를 의미하지 않음 |

### Archive SHA-256

| 제품 | 수집 zip hash |
|---|---|
| magents | 52d2956fca37819722c4b3300f389b2ed5c293cf046aad1aa47746dbbb7f408b |
| agent-intercom | 3dcc33fa6ad1b74c6975b121d0e537eb2d36f5373ea29ab34067ba5ccaeb1f9d |
| agentmux | 65b71c7aa36f098915db19b13dfcd684f6698d099ce4f7ac3efb9f7664434162 |
| Orchestra | 921091878fb8002d018114b2dc7e39ff0f2d3eda14a806b68114d6448fc9db0a |

### 로컬 원자료 위치

프로젝트 루트는 C:/Users/jhjang/vault623/workspace/projects/inter-session-orchastrator다.

| 프로젝트 상대 경로 | 역할 |
|---|---|
| .research-cache/product/SHA/source.zip | 제품별 원본 archive. .gitignore로 제외 |
| .research-cache/product/SHA/source/ | 정적 열람용 소스. 설치·실행하지 않음 |
| docs/research/evidence/source-manifest.json | source revision, archive hash, 조회 시각, release metadata |
| docs/research/evidence/host-reference-manifest.json | OpenClaw 선택 파일 URL·hash |
| docs/research/evidence/orca-*-guide.json | 설치 시점의 CLI 가이드 |
| docs/research/evidence/orca-binary-version.json | 설치 Orca 버전 관측 |
| docs/research/evidence/local-reuse-manifest.json | NotebookLM 실제 파일 hash·행 수 |
| docs/research/evidence/claim-ledger.json | 분석 claim의 고정 소스·행·URL |
| docs/research/evidence/review-validation.json | 문서 검사·본문 동등성·근거 행 검증 결과 |
| tools/collect_benchmarks.py | 공개 archive 수집 절차 |
| tools/collect_host_references.py | OpenClaw 제한 수집 절차 |
| tools/research_read.py | 고정 소스를 번호와 함께 읽는 절차 |

수집은 공개 GitHub API와 codeload/raw 주소를 사용한다. 개인 credential·세션 transcript·전역 설정은 원자료에 포함하지 않았다.

### 근거 경로

```mermaid
flowchart LR
    A[공개 repo와 로컬 가이드] --> B[SHA 또는 파일 hash 고정]
    B --> C[원자료 manifest]
    C --> D[파일과 행 번호의 claim ledger]
    D --> E[제품별 조사 노트]
    E --> F[비교 분석]
    F --> G[미실행 검증 계획]
```

## 상충 근거

README의 “기존 세션”, “native”, “한 번만 전달” 같은 표현은 같은 기술 계약을 뜻하지 않는다. 해석이 갈린 항목은 제품별 노트에 실제 source 경로와 정적 추론을 분리했다.

상위 release API가 반환한 태그는 항상 desktop runtime의 최신 릴리즈를 뜻하지 않는다. agentmux의 Android 태그가 그 사례다.

## 한계

- 모든 archive 파일을 분석하거나 모든 공개 issue·commit history를 감사하지 않았다.
- 공개 소스를 받은 것과 설치·빌드·실행 검증은 다르다. 이번에는 후자를 수행하지 않았다.
- race/crash 동작의 위험은 선택 경로의 정적 분석이며 발생률이나 실제 사고를 측정하지 않았다.
- 로컬 원자료가 삭제되더라도 고정 공개 permalink와 archive hash로 동일 출처를 다시 찾을 수 있다.
- 후속 수집 시 HEAD가 바뀌면 이번 결과를 덮어쓰지 말고 새 manifest revision과 차이를 기록해야 한다.

## 권고

원자료 식별자 → 제품별 분석 → 종합 판단 → 실제 검증 결과의 순서를 유지한다. 어떤 호스트가 어느 세션을 소유하고 무엇을 성공으로 판정하는지 확인하기 전에는 구현 기능으로 확정하지 않는다.

## 관련 노트

- [[inter-session-index]]
- [[magents-benchmark]]
- [[intercom-benchmark]]
- [[agentmux-benchmark]]
- [[orchestra-benchmark]]
- [[host-reference-benchmark]]
- [[benchmark-analysis]]
- [[benchmark-validation-plan]]

