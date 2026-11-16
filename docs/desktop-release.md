# Windows 빌드

## 개발 실행

Node.js 24.14.1과 npm이 필요합니다.

```powershell
npm ci
npm run dev
```

기본 주소는 `http://127.0.0.1:4318/`입니다. 개발 데이터는 Git에서 제외되는 `.local/`에 저장합니다.

참여 세션 검색·Native Chat 연결·새 세션 생성에는 실행 중인 Orca가 필요합니다.
좌장으로 사용할 Claude Code 또는 Codex CLI를 설치하고 로그인하세요.
Claude 실행 파일의 위치가 기본 설치 경로와 다르면 `CLAUDE_CHAIR_COMMAND`로 지정할 수 있습니다.

## 검사

```powershell
npm run verify:web
npm run verify:electron
```

Electron 검사는 Rust guardian을 빌드하므로 Rust/Cargo가 필요합니다.
검사는 격리된 데이터와 가짜 provider를 사용합니다. 실제 세션 연결과 모델 응답은 별도로 확인해야 합니다.

## 설치 파일 생성

Windows x64, Rust/Cargo, Inno Setup 6이 필요합니다.
`ISCC.exe`를 자동으로 찾지 못하면 `INNO_SETUP_COMPILER`에 실행 파일의 절대 경로를 지정하세요.

1. `VERSION`과 `desktop/shells/electron/package.json`, `package-lock.json`의 버전을 맞춥니다.
2. 변경 사항을 커밋합니다. 미커밋 변경이 있으면 릴리스 빌드가 중단됩니다.
3. 다음 명령을 실행합니다.

```powershell
npm run build:installer
```

빌드는 커밋의 소스 스냅샷에서 의존성 설치·웹 검사·Electron 검사·패키징을 진행합니다.
새 임시 프로필로 패키지를 실행하고 인증, 화면 로딩, 정상 종료와 프로세스·포트 정리를 확인합니다.
통과한 설치 파일은 저장소 루트에 `SessionRooms-<version>-x64-setup.exe`로 생성됩니다.
빌드 기록과 해시는 `dist/<build-id>/release-provenance.json`, `installer-provenance.json`에 남습니다.

설치 파일 생성은 기존 앱의 종료나 설치, 사용자 프로필 교체를 수행하지 않습니다.
