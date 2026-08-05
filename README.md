
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
🚀 시작하기 (Getting Started)
1. 저장소 클론 (Clone Repository)
git clone [https://github.com/DDeumBugi6827/Rusty_Traveler.git](https://github.com/DDeumBugi6827/Rusty_Traveler.git)
cd Rusty_Traveler
2. 백엔드 서버 실행 (Start Backend Server)
cd server
npm install
node index.js
* 서버는 기본적으로 ws://localhost:3000 (또는 지정된 포트)에서 실행됩니다.
3. 프론트엔드 개발 서버 실행 (Start Client Development Server)
새 터미널 창을 열고 프로젝트 루트 디렉터리에서 실행합니다.
# 프로젝트 루트 디렉터리로 이동
npm install
npm run dev
* 웹 브라우저에서 http://localhost:5173 접속 후 이용하실 수 있습니다.
✨ 주요 기능 (Key Features)
* 3D 월드 탐험: GLTF/GLB 3D 맵 로딩 및 충돌 검사 지원
* 실시간 멀티플레이어 동기화: WebSocket을 통한 타 플레이어 위치, 회전, 애니메이션 상태 동기화
* 상호작용 기능: 실시간 텍스트 채팅 및 이모지 반응 효과
* 사운드 및 효과: 배경음악(BGM), 발소리 사운드 효과 및 모래폭풍 파티클 연출
