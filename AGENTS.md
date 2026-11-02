# 저장소 작업 지침

- 이 저장소는 공용 웹 SSR 함수와 Hosting 요청 Gateway를 관리합니다. 앱별 화면·라우트·메타 필드 매핑은 각 FE 앱 저장소의 렌더러가 소유합니다.
- `functions/appWebSsr`와 `functions/appWebGateway`는 별도 Firebase 프로젝트에 배포됩니다. 배포 전에 `--config`와 `--project`를 모두 확인하고, `kp-k00001`에는 명시적 요청 없이는 배포하지 않습니다.
- `.env*`, 키 파일, 토큰, 개인 설정을 커밋하지 않습니다. `.gitignore` 설정을 유지합니다.
- 문서 변경은 한국어로 작성합니다.
