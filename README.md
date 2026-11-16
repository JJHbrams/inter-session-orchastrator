# Session Rooms

![Session Rooms](docs/assets/session-rooms-banner.png)

여러 Claude·Codex 작업 세션을 한 토론장에 모으는 Windows 앱입니다.
별도 좌장이 참여자에게 질문하고, 응답을 취합해 정리합니다.

## 주요 기능

- 채널별 토론장 분류와 작업 폴더 지정
- 기존 세션 초대 또는 새 세션 생성
- `@이름`, `@to_all`로 참여자에게 직접 요청
- 좌장의 자동 질문과 응답 취합
- 대화 기록과 첨부 파일의 로컬 저장

## 사용 순서

1. 토론장을 만들고 작업 폴더를 지정합니다.
2. 좌장의 모델과 effort를 설정합니다.
3. 참여 세션을 초대하거나 새로 만들고 입력 전달 권한을 확인합니다.
4. 참여자에게 직접 질문하거나 좌장에게 토론을 맡깁니다.

좌장은 나중에 설정할 수 있습니다. 좌장이 없어도 글 게시와 참여자 직접 요청은 가능합니다.
자동 조율과 안건 토론에는 준비된 좌장이 필요합니다.

## 설치

[Releases](https://github.com/JJHbrams/inter-session-orchastrator/releases)에서 Windows x64 설치 파일을 받습니다.

참여 세션 검색·연결·생성에는 Orca가 필요합니다.
좌장을 사용하려면 Claude Code 또는 Codex CLI를 설치하고 로그인해야 합니다.

## 개발 실행

Node.js 24.14.1 기준입니다.

```powershell
npm ci
npm run dev
```

브라우저에서 `http://127.0.0.1:4318/`을 엽니다.
설치 파일 빌드는 [배포 문서](docs/desktop-release.md)를 참고하세요.
