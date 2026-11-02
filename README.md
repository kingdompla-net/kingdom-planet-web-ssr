# Kingdom Planet 웹 SSR

Kingdom Planet 웹 앱의 공용 문서 요청 처리 코드를 관리합니다. Firebase Functions 2세대 함수인 `appWebGateway`와 `appWebSsr`를 각각 다른 Firebase 프로젝트에 배포할 수 있도록 구성합니다.

## 구성

```text
functions/
├── appWebGateway/   # Hosting에서 받은 페이지 요청을 appWebSsr로 전달
└── appWebSsr/       # 앱 정보와 FE 렌더러로 HTML 문서를 생성
```

현재 실험 환경의 프로젝트 경계는 다음과 같습니다.

| 역할 | 프로젝트 | 이 저장소에서의 처리 |
|---|---|---|
| FE Hosting 및 Gateway | `kp-ssr-proxy-poc-20261028` | `appWebGateway` 배포 대상. Hosting rewrite 설정은 FE 앱 저장소에 둡니다. |
| 공용 SSR | `kingdom-planet-ssr` | `appWebSsr` 배포 대상 |
| KP API | `kingdom-planet-dev` | SSR 함수가 앱 정보를 조회하는 upstream |

`kp-k00001`에는 이 실험에서 배포하지 않습니다.

## 요청 흐름

```text
브라우저 문서 요청
  → FE Hosting rewrite
  → appWebGateway (Hosting과 같은 Firebase 프로젝트)
  → appWebSsr (kingdom-planet-ssr)
  → KP API의 appGetAppByHost 또는 설정된 appGetApp 조회
  → 해당 앱 호스트의 manifest.json 및 /ssr/entry-server.js 읽기
  → 로고를 WebP data URI로 변환하고 HTML 반환
```

현재 `appWebSsr`는 로고와 텍스트 메타데이터 외에도 앱 호스트에서 `manifest.json` 및 `/ssr/entry-server.js`를 가져옵니다. FE의 `entry-server.tsx`가 만든 HTML을 문서에 넣으므로 서버 렌더되는 화면 범위는 앱별 FE 렌더러가 결정합니다. 이 저장소에는 앱별 렌더러나 FE 정적 이미지·PDF 파일을 복사하지 않습니다. 앱별 FE 렌더러는 각 FE 앱 저장소에서 빌드·제공해야 합니다.

`appWebGateway`는 `/kp-api/**` 요청을 `KP_API_BASE_URL`로 전달하는 경로도 지원합니다. 기존 FE 코드가 KP API의 절대 주소를 사용하면 그 요청은 Gateway를 통과하지 않습니다.

## 설정

비밀값이나 앱별 환경 파일은 저장소에 커밋하지 않습니다. Firebase CLI에 프로젝트별 함수 설정을 제공하세요.

- `appWebGateway`: `APP_WEB_SSR_URL`, `KP_API_BASE_URL` Firebase Functions 파라미터
- `appWebSsr`: `APP_WEB_SSR_API_BASE_URL` 또는 `KINGDOM_PLANET_API_URL`
- 필요한 경우 `APP_WEB_SSR_HOST_MAP`으로 실험용 호스트와 `app_id`를 연결할 수 있습니다.

`.env*` 파일은 Git에서 제외합니다. 실제 프로젝트에 적용하는 값은 해당 Firebase 프로젝트의 비밀·설정 관리 경로에서 별도로 관리하세요.

## 배포

Firebase CLI에 로그인되어 있고 대상 프로젝트 접근 권한이 있는 환경에서 각 함수를 따로 배포합니다.

```bash
firebase deploy --config firebase.app-web-ssr.json --project ssr --only functions:appWebSsr
firebase deploy --config firebase.app-web-gateway.json --project gateway-poc --only functions:appWebGateway
```

Gateway를 Hosting rewrite가 참조하려면 Gateway 함수가 해당 Hosting 사이트와 같은 Firebase 프로젝트에 있어야 합니다. 임시 PoC와 `kingdom-planet-ssr`은 별도 프로젝트이므로 두 함수를 각각 배포합니다.
현재 배포는 위 Firebase CLI 명령으로 수행합니다. GitHub에 푸시할 때 자동 배포하려면 GitHub Actions의 인증과 배포 workflow를 별도로 구성해야 합니다.

## 확인

SSR 함수의 기존 단위 테스트는 다음 명령으로 실행할 수 있습니다.

```bash
cd functions/appWebSsr
npm install
npm test
```
