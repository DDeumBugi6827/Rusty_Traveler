# 🧭 Rusty Traveler

> Three.js와 WebSocket 기반의 3D 웹 멀티플레이어 탐험 게임 프로젝트입니다.

---

## 📌 프로젝트 소개 (About Project)

**Rusty Traveler**는 웹브라우저에서 실행되는 3D 탐험 게임입니다.
Three.js를 사용하여 3D 필드, 충돌체, 모래폭풍 파티클 효과, 캐릭터 애니메이션을 구현하였으며, WebSocket을 이용해 멀티플레이어 간 위치 동기화, 실시간 채팅, 이모지 반응을 지원합니다.

---

## 🛠 기술 스택 (Tech Stack)

### Frontend
- **Language**: TypeScript
- **Framework & Build Tool**: Vite
- **3D Graphics**: Three.js (WebGL)
- **Styling**: HTML5, CSS3

### Backend
- **Runtime**: Node.js
- **Server**: Express
- **Real-time Communication**: WebSocket (`ws`)

---

## 📁 프로젝트 구조 (Project Structure)

```text
Rusty_Traveler/
├── public/                # 3D 모델(.glb), 오디오(.mp3), HDR 환경맵 파일
├── server/                # WebSocket 백엔드 서버
│   └── index.js           # 서버 메인 로직 (클라이언트 연결 및 메시지 브로드캐스트)
├── src/                   # 클라이언트 TypeScript 소스 코드
│   ├── app.ts             # 게임 루프 및 앱 진입점
│   ├── network.ts         # WebSocket 클라이언트 통신 로직
│   ├── particles.ts       # 파티클 시스템 (모래폭풍 효과)
│   ├── player.ts          # 플레이어 조작, 물리 및 애니메이션
│   ├── scene.ts           # Three.js 씬, 조명, 3D 모델 및 충돌체 로딩
│   └── ui.ts              # 채팅 UI, 이모지 피커 및 로딩 화면
├── game.html              # 게임 화면 캔버스 템플릿
├── index.html             # 메인 랜딩 페이지
├── package.json           # 클라이언트 의존성 및 스크립트 설정
├── tsconfig.json          # TypeScript 설정
└── vite.config.ts         # Vite 빌드 설정
