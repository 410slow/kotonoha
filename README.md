# KOTONOHA v0.9

실질적인 첫 번째 '오늘의 레슨' 버전입니다.

## 새 기능
- 오늘의 레슨 중심 홈
- 사토 선생님 레슨 화면
- 일본어 직접 입력 문제
- 문장 자동 채점
- 오답 부분 표시
- 힌트
- 받아쓰기
- 체크리스트 대신 문제형 숙제
- 숙제 자동 채점
- 오답노트 자동 저장
- 다음 Day 자동 증가
- 기존 Firebase 학습자 데이터 호환

## 실행
```bash
npm install
npm run dev
```

---

## 🎮 보너스: 친구 때리고 도망가기 (엥마 게임)

`game/` 폴더에 들어 있는 별도 미니게임입니다. 카메라를 켜면 **지금 내가 있는 현실 공간**에 친구가 나타납니다.

- 실행: `npm run dev` 후 **http://localhost:5173/game/index.html**
- 조작: `살금살금`(W) 꾹 누르고 다가가기 → 친구가 커지면 **얼굴 탭/클릭**으로 때리기 → `도망!`(Space) 꾹 눌러 도망
- 친구가 뒤돌아볼 때(👀) 움직이면 들킵니다.
- 맞거나 나를 잡으면 친구가 얄밉게 **"엥마~"** 라고 말합니다.
- 걷기/뛰기 발소리, 펀치 소리는 브라우저에서 합성됩니다.
- 친구 실제 목소리를 쓰려면 `game/voice/engma.mp3` 를 넣으세요 (`game/voice/README.md` 참고).
- 폰에서 카메라를 쓰려면 https 주소가 필요합니다. 카메라가 안 되면 시작 화면의 **배경 사진 선택**으로 플레이할 수 있습니다.
- 얼굴 사진은 `game/assets/*.png` (평소/맞음/엥마/추격/보너스) 를 바꾸면 다른 친구로 교체됩니다.

### 카톡으로 공유하기 (로그인 없이 링크만 열면 바로 플레이)

게임은 `game/` 폴더 하나로 완결된 정적 페이지라서 아무 https 호스팅에나 올리면 됩니다. 두 가지 방법을 준비해 두었습니다.

1. **GitHub Pages** (`.github/workflows/pages.yml`)
   - 저장소 **Settings → Pages → Source** 를 `GitHub Actions` 로 설정합니다.
   - `main` 에 머지하거나 Actions 탭에서 워크플로를 수동 실행(Run workflow)하면
     **https://410slow.github.io/kotonoha/** 주소가 생깁니다. 이 링크를 카톡방에 올리면 끝.
   - 주의: 무료 계정은 **공개(public) 저장소**에서만 Pages 가 동작합니다. 비공개로 두려면 아래 2번을 쓰세요.
2. **Firebase Hosting** (`firebase.json`, 이미 쓰는 Firebase 프로젝트 재사용)
   ```bash
   npx firebase-tools login
   npx firebase-tools use <파이어베이스-프로젝트-ID>
   npx firebase-tools deploy --only hosting
   ```
   출력되는 `https://<프로젝트>.web.app` 링크를 공유하면 됩니다.

링크를 연 사람은 로그인 없이 카메라 권한만 허용하면 바로 게임이 시작됩니다. 친구 얼굴 사진도 함께 공개되는 링크이니 친구 동의는 받아 두세요.
