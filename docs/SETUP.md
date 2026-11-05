# 설치·배포 안내 (MJC Table)

학생 앱, 직원 POS, 관리자 프로그램 3개가 하나의 데이터로 실시간 연결되는 학생식당 플랫폼입니다.

| 프로그램 | 경로 | 사용자 | 주요 기능 |
| --- | --- | --- | --- |
| 학생 앱 (아이폰 웹앱) | `app/index.html` | 학생 | 식당 5곳·메뉴 45개, 식당별 예상 대기, AI 대기 예측·예약 주문, AI 메뉴 추천(자연어 → SQL), 비회원 오늘의 추천 / 데모 로그인 후 개인 추천·칼로리 기록, 주문 현황 알림 |
| 직원 POS (PC) | `pos/index.html` | 조리실 직원 | 식당별 주문 필터, 주문 접수 → 조리 → 픽업 알림, 조리 예상 시간, 품절 처리, 픽업 보드 |
| 관리자 (PC) | `admin/index.html` | 식당 관리자 | 식당별 메뉴·가격·노출과 영업 스위치, 영업시간, 재고·발주, AI 예측 설정, 매출 대시보드 |

## 바로 실행하기

1. 폴더에서 `index.html`을 더블클릭하면 세 프로그램으로 가는 시작 페이지가 열려요.
2. **직원 POS**를 열고 아래 '초기화'를 누르면 시연 데이터(16건, 99,000원)로 맞춰져요.
3. 같은 브라우저의 탭끼리는 바로 연결돼요. (학생 앱에서 주문 → POS에 즉시 표시)

> 더블클릭(file://)으로 열어도 동작하지만, 아이폰에서 앱처럼 쓰려면 Netlify에 올리는 걸 추천해요.

## AI 키 설정 (개발자가 한 번만)

키는 **앱 코드에 넣지 않아요.** 웹앱 코드는 누구나 볼 수 있어서 키가 그대로 노출되기 때문이에요.
대신 Netlify 서버에 키를 한 번 붙여 넣으면, 앱을 여는 **모든 사람이 키 없이** AI 추천을 써요.

1. BAZE 콘솔에서 **API 키 생성**을 누르고 키를 복사해요. (키는 한 번만 보여요)
2. BAZE 콘솔 **모델** 탭에서 크레딧 단가가 낮은 모델의 **모델 ID**를 복사해요.
3. Netlify 사이트 → **Site configuration → Environment variables → Add a variable**에서 두 개를 붙여 넣어요.

   | Key | Value |
   | --- | --- |
   | `BAZE_API_KEY` | 1번에서 복사한 키 |
   | `BAZE_MODEL` | 2번에서 복사한 모델 ID |

4. **Deploys → Trigger deploy**로 다시 배포해요.
5. 학생 앱 **마이** 탭에 "AI 추천을 쓸 수 있어요"가 보이면 끝이에요.

> 문제가 있으면 주소 끝에 `?dev=1`을 붙여 열어 보세요(예: `/app/index.html?dev=1`). 마이 탭에 서버 상태와 오류가 보여요. `?dev=0`으로 다시 숨겨요.

### Netlify에 올리는 방법

서버 함수(`netlify/functions/ai.js`)가 함께 올라가야 AI가 동작해요. 아래 둘 중 하나를 쓰세요.

- **GitHub 연결(추천):** 이 폴더를 GitHub 저장소에 올리고 Netlify에서 **Add new site → Import an existing project**로 연결해요. `.gitignore`가 `.env`를 막아 두어서 키 파일은 올라가지 않아요.
- **Netlify CLI:** 터미널에서
  ```
  npm install -g netlify-cli
  netlify login
  netlify deploy --prod
  ```

> 폴더를 끌어다 놓는 수동 배포는 서버 함수가 함께 올라가지 않을 수 있어요. 그 방식으로 올렸다면 마이 탭(`?dev=1`)에서 '서버 함수를 찾지 못함'이 나오는지 확인하세요.

### 내 컴퓨터에서 미리 테스트하기 (선택)

`.env.example`을 복사해 이름을 `.env`로 바꾸고 `=` 뒤에 키와 모델 ID를 붙여 넣은 뒤 `netlify dev`를 실행해요. `http://localhost:8888/app/`에서 서버 함수까지 똑같이 동작해요.

### 보호 장치와 한계

- 키는 서버에만 있고 응답에 포함되지 않아요. 모델도 서버 설정만 따라서, 화면에서 비싼 모델을 골라 크레딧을 쓸 수 없어요.
- 다른 웹사이트에서 이 서버 함수를 부르는 건 막고, 한 사람(IP)이 1분에 15번까지만 요청할 수 있어요(`RATE_LIMIT_PER_MIN`으로 조절).
- 다만 주소를 아는 사람이 앱처럼 꾸며 요청하는 것까지 완전히 막지는 못해요. **시연 기간에만 키를 넣고, 끝나면 환경 변수에서 지우고 BAZE에서 키를 폐기하세요.**

## 다른 기기끼리 연결하기 (Supabase)

1. Supabase SQL Editor에서 `supabase_setup.sql`을 실행해요.
2. `shared/supabase-sync.js` 맨 위 `SUPABASE_URL`, `SUPABASE_ANON_KEY`에 값을 넣어요.
3. 이제 휴대폰(학생 앱)과 노트북(POS·관리자)이 실시간으로 연결돼요.

## AI 구조

```
[학생 질문] "고기 말고 국물, 10분 안에"
   │
   ▼
[LLM: 학교 BAZE 또는 Claude API] 메뉴 스키마 + 학생 정보(남은 칼로리, 최근 주문, 피할 재료) + 대기 예측
   │   → JSON { sql, reply, pick_ids, action }
   ▼
[SQL 검사] SELECT · menus 테이블만 허용
   ▼
[SQLite(sql.js)] 오늘 메뉴 데이터에서 SQL 실행
   ▼
[학생 앱] 추천 메뉴 + 이유 + "12:40 예약으로 담기"(예측이 행동을 바꾸는 지점)
```

- 메뉴별 예상 수령 시간 = 공통 혼잡(AI 시간대 예측 × 0.45) + **그 식당 주방의 대기열** + 메뉴 조리 시간. 식당마다 주방이 따로라, 주문이 몰린 식당만 대기가 길어져요. (`shared/store.js`의 `menuWait`)
- 회원/비회원: 비회원도 주문·예약·AI 추천을 모두 쓰고, 데모 계정으로 로그인하면 최근 주문과 남은 칼로리까지 반영해요. 실제 로그인은 2단계에서 학교 계정(Supabase Auth)으로 연결할 예정이에요.
- 메뉴 데이터는 시연용 예시예요. 사진이 있는 6개 외에는 일러스트로 표시하고, `images/`에 사진을 넣고 `shared/store.js`의 `img`에 파일 이름을 적으면 바뀌어요.
- 대기 예측: `predict.py`(랜덤 포레스트: 시각, 요일, 직전 15분 주문 수, 시험기간, 교내 행사, 비)의 시간대별 예측 × 학사일정 계수와 POS의 실시간 조리 대기열을 6:4로 합쳐 '지금 대기'를 계산해요. (`shared/store.js`의 `predict`)
- 현재 앱의 시간대별 예측표(`BASE_TIMELINE`)는 시연용 고정값이에요. 2단계에서 `predict.py` 결과를 API로 받아 바꿀 예정이에요.

## 파일 구조

```
index.html               시작 페이지
app/                     학생 앱 (+ 홈 화면 아이콘, manifest)
pos/                     직원 POS
admin/                   관리자
shared/store.js          공통 데이터·예측·재고 계산
shared/ai.js             AI 메뉴 추천 (Claude + NL2SQL + 규칙 기반 대체)
shared/supabase-sync.js  기기 간 실시간 동기화 (선택)
netlify/functions/ai.js  Claude API 키를 숨기는 서버 함수
images/                  메뉴 사진
predict.py               대기 예측 모델 학습·추론
schema.sql               MySQL 스키마 (설계 문서용)
supabase_setup.sql       Supabase 테이블·권한·실시간 설정
```
