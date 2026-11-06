/* =====================================================================
   MJC Table 공통 데이터 계층 (shared/store.js)
   학생 앱, 직원 POS, 관리자 프로그램이 모두 이 파일을 불러와 같은 데이터를 씁니다.
   - 저장: 브라우저 localStorage (supabase-sync.js를 켜면 Supabase와 실시간 동기화)
   - 예측: 시간대별 AI 예측값 × 학사일정 계수 + 실시간 조리 대기열
   ===================================================================== */
(function (global) {
  'use strict';

  var MIN = 60000;
  var KEYS = {
    orders: 'smartorder.orders',
    soldOut: 'smartorder.soldout',
    seq: 'smartorder.seq',
    version: 'smartorder.pos.version',
    demoOffset: 'smartorder.pos.demoOffset',
    menus: 'smartorder.menus',
    hours: 'smartorder.hours',
    inventory: 'smartorder.inventory',
    purchases: 'smartorder.purchases',
    aiConfig: 'smartorder.aiconfig',
    profile: 'smartorder.profile',
    claudeKey: 'smartorder.claudeKey',
    restaurants: 'smartorder.restaurants',
    aiStats: 'smartorder.aistats',
    session: 'smartorder.session'
  };
  var DATA_VERSION = '9';
  var FIRST_ORDER_NUMBER = 102;
  var DEMO_START = '12:20';

  /* 사진 폴더: 이 스크립트(shared/store.js) 기준 ../images/ */
  var IMG_BASE = (function () {
    try { return new URL('../images/', document.currentScript.src).href; } catch (e) { return '../images/'; }
  })();

  /* ---------- 식당 5곳 (구시아 푸드마켓 위탁 학생식당을 가정한 시연 데이터) ---------- */
  var RESTAURANTS = [
    { id: "rice", name: "한그릇 덮밥", category: "밥", desc: "갓 지은 밥 위에 든든한 한 그릇", emoji: "🍚", cover: 4, tone: ["#FFF4E0", "#FFE2B8"], open: true },
    { id: "noodle", name: "면 공방", category: "면", desc: "매일 뽑는 면과 진한 육수", emoji: "🍜", cover: 3, tone: ["#FFF7E6", "#F6E3C2"], open: true },
    { id: "katsu", name: "바삭 돈까스", category: "돈까스", desc: "주문하면 바로 튀기는 두툼한 돈까스", emoji: "🍖", cover: 5, tone: ["#FFEEDD", "#FFD3AE"], open: true },
    { id: "snack", name: "분식 스테이션", category: "분식", desc: "빠르고 가볍게, 학교 앞 분식 그대로", emoji: "🍢", cover: 6, tone: ["#FFE9E6", "#FFC9C2"], open: true },
    { id: "soup", name: "든든 국밥", category: "국물", desc: "뚝배기에 바로 끓여 내는 국밥과 찌개", emoji: "🍲", cover: null, tone: ["#FBEFE8", "#F0D5C6"], open: true }
  ];

  /* ---------- 기본 메뉴 45개 (관리자 프로그램에서 수정 가능, 사진이 없으면 일러스트) ---------- */
  var DEFAULT_MENUS = [
    { menu_id: 1, restaurant: "noodle", name: "사골 손칼만두", short: "손칼만두", category: "면", price: 6000, cook: 7, kcal: 650, protein: 27, spicy: 0, has_meat: 1, soup: 1, tag: "국물 진한", desc: "진한 사골 국물에 손만두와 칼국수를 한 그릇에", img: "kalmandu.jpg", emoji: "🥟", visible: true, ingredients: {"dumpling": 3, "noodle": 1, "broth": 0.5} },
    { menu_id: 2, restaurant: "rice", name: "대패 마늘쫑 비빔밥", short: "대패 비빔밥", category: "밥", price: 6500, cook: 5, kcal: 780, protein: 33, spicy: 1, has_meat: 1, soup: 0, tag: "든든함", desc: "불향 입힌 대패 삼겹에 매콤한 마늘쫑, 달걀프라이", img: "bibimbap.jpg", emoji: "🍚", visible: true, ingredients: {"rice": 1, "pork_belly": 1, "egg": 1} },
    { menu_id: 3, restaurant: "noodle", name: "통닭다리 쌀국수", short: "닭다리 쌀국수", category: "면", price: 6500, cook: 6, kcal: 610, protein: 41, spicy: 0, has_meat: 1, soup: 1, tag: "고단백", desc: "맑은 닭 육수에 통닭다리 하나, 숙주와 고추 듬뿍", img: "chicken-pho.jpg", emoji: "🍜", visible: true, ingredients: {"rice_noodle": 1, "chicken_leg": 1, "broth": 0.5} },
    { menu_id: 4, restaurant: "rice", name: "온천달걀 규동", short: "규동", category: "밥", price: 6000, cook: 5, kcal: 820, protein: 34, spicy: 0, has_meat: 1, soup: 0, tag: "달걀 톡", desc: "달콤짭짤한 소고기 양파볶음에 온천달걀을 톡", img: "gyudon.jpg", emoji: "🍚", visible: true, ingredients: {"rice": 1, "beef": 1, "egg": 1} },
    { menu_id: 5, restaurant: "katsu", name: "매콤 양념 돈까스", short: "양념 돈까스", category: "돈까스", price: 7000, cook: 8, kcal: 950, protein: 35, spicy: 1, has_meat: 1, soup: 0, tag: "인기 1위", desc: "바삭한 등심 돈까스에 매콤달콤 양념 소스", img: "donkatsu.jpg", emoji: "🍖", visible: true, ingredients: {"pork_loin": 1, "rice": 1} },
    { menu_id: 6, restaurant: "snack", name: "뚝배기 순두부 라면", short: "순두부 라면", category: "분식", price: 4500, cook: 4, kcal: 600, protein: 19, spicy: 1, has_meat: 0, soup: 1, tag: "얼큰함", desc: "얼큰한 국물에 몽글몽글 순두부를 넣은 뚝배기 라면", img: "sundubu-ramen.jpg", emoji: "🍲", visible: true, ingredients: {"ramen": 1, "tofu": 1} },
    { menu_id: 7, restaurant: "rice", name: "제육덮밥", short: "제육덮밥", category: "밥", price: 5500, cook: 5, kcal: 760, protein: 30, spicy: 1, has_meat: 1, soup: 0, tag: "매콤", desc: "불향 입힌 매콤달콤 제육볶음을 밥 위에", img: "jeyuk-deopbap.jpg", emoji: "🍛", visible: true, ingredients: {"rice": 1, "pork": 1} },
    { menu_id: 8, restaurant: "rice", name: "치킨마요덮밥", short: "치킨마요", category: "밥", price: 5000, cook: 4, kcal: 720, protein: 28, spicy: 0, has_meat: 1, soup: 0, tag: "학생 최애", desc: "바삭한 치킨에 마요와 데리야끼 소스", img: null, emoji: "🍗", visible: true, ingredients: {"rice": 1, "chicken": 1} },
    { menu_id: 9, restaurant: "rice", name: "참치마요덮밥", short: "참치마요", category: "밥", price: 4500, cook: 3, kcal: 650, protein: 22, spicy: 0, has_meat: 0, soup: 0, tag: "가성비", desc: "고소한 참치마요에 김가루 듬뿍", img: "tuna-mayo.jpg", emoji: "🍙", visible: true, ingredients: {"rice": 1, "egg": 1} },
    { menu_id: 10, restaurant: "rice", name: "김치볶음밥", short: "김치볶음밥", category: "밥", price: 5000, cook: 5, kcal: 690, protein: 18, spicy: 1, has_meat: 1, soup: 0, tag: "달걀프라이", desc: "잘 익은 김치와 햄을 볶아 달걀프라이를 올려", img: "kimchi-fried-rice.jpg", emoji: "🍳", visible: true, ingredients: {"rice": 1, "egg": 1, "pork": 0.5} },
    { menu_id: 11, restaurant: "rice", name: "카레라이스", short: "카레라이스", category: "밥", price: 5000, cook: 3, kcal: 700, protein: 16, spicy: 0, has_meat: 1, soup: 0, tag: "순한 맛", desc: "감자와 당근을 듬뿍 넣은 일본식 카레", img: "curry-rice.jpg", emoji: "🍛", visible: true, ingredients: {"rice": 1} },
    { menu_id: 12, restaurant: "rice", name: "불고기덮밥", short: "불고기덮밥", category: "밥", price: 6000, cook: 5, kcal: 740, protein: 32, spicy: 0, has_meat: 1, soup: 0, tag: "달콤짭짤", desc: "간장 양념 소불고기와 양파를 듬뿍", img: "bulgogi-deopbap.jpg", emoji: "🥩", visible: true, ingredients: {"rice": 1, "beef": 1} },
    { menu_id: 13, restaurant: "rice", name: "오징어덮밥", short: "오징어덮밥", category: "밥", price: 6000, cook: 6, kcal: 680, protein: 29, spicy: 1, has_meat: 0, soup: 0, tag: "매콤", desc: "통통한 오징어를 매콤하게 볶아 밥 위에", img: "ojingeo-deopbap.jpg", emoji: "🦑", visible: true, ingredients: {"rice": 1, "seafood": 1} },
    { menu_id: 14, restaurant: "noodle", name: "잔치국수", short: "잔치국수", category: "면", price: 4000, cook: 4, kcal: 480, protein: 14, spicy: 0, has_meat: 0, soup: 1, tag: "가벼움", desc: "멸치 육수에 애호박과 달걀지단, 김가루", img: null, emoji: "🍜", visible: true, ingredients: {"noodle": 1, "broth": 0.5, "egg": 0.5} },
    { menu_id: 15, restaurant: "noodle", name: "비빔국수", short: "비빔국수", category: "면", price: 4500, cook: 4, kcal: 560, protein: 13, spicy: 1, has_meat: 0, soup: 0, tag: "새콤달콤", desc: "새콤달콤 고추장 양념에 오이를 듬뿍", img: "bibim-guksu.jpg", emoji: "🍝", visible: true, ingredients: {"noodle": 1, "egg": 0.5} },
    { menu_id: 16, restaurant: "noodle", name: "냉모밀", short: "냉모밀", category: "면", price: 5500, cook: 4, kcal: 520, protein: 17, spicy: 0, has_meat: 0, soup: 1, tag: "시원함", desc: "살얼음 쯔유에 메밀면과 무즙", img: "naengmomil.jpg", emoji: "🥢", visible: true, ingredients: {"noodle": 1, "broth": 0.3} },
    { menu_id: 17, restaurant: "noodle", name: "짜장면", short: "짜장면", category: "면", price: 5000, cook: 6, kcal: 780, protein: 20, spicy: 0, has_meat: 1, soup: 0, tag: "꾸덕함", desc: "춘장에 돼지고기와 양파를 듬뿍 볶아", img: null, emoji: "🍝", visible: true, ingredients: {"noodle": 1, "pork": 0.5} },
    { menu_id: 18, restaurant: "noodle", name: "짬뽕", short: "짬뽕", category: "면", price: 6000, cook: 7, kcal: 690, protein: 28, spicy: 1, has_meat: 1, soup: 1, tag: "얼큰함", desc: "해산물과 채소를 센 불에 볶은 얼큰한 국물", img: "jjamppong.jpg", emoji: "🍜", visible: true, ingredients: {"noodle": 1, "seafood": 1, "broth": 0.5} },
    { menu_id: 19, restaurant: "noodle", name: "우동", short: "우동", category: "면", price: 5000, cook: 5, kcal: 520, protein: 16, spicy: 0, has_meat: 0, soup: 1, tag: "따끈함", desc: "가쓰오 국물에 탱탱한 우동면", img: "udon.jpg", emoji: "🍲", visible: true, ingredients: {"noodle": 1, "broth": 0.5} },
    { menu_id: 20, restaurant: "noodle", name: "쫄면", short: "쫄면", category: "면", price: 5000, cook: 4, kcal: 600, protein: 15, spicy: 1, has_meat: 0, soup: 0, tag: "쫄깃함", desc: "쫄깃한 면에 아삭한 채소와 매콤한 소스", img: "jjolmyeon.jpg", emoji: "🥗", visible: true, ingredients: {"noodle": 1, "egg": 0.5} },
    { menu_id: 21, restaurant: "katsu", name: "등심 돈까스", short: "등심 돈까스", category: "돈까스", price: 7000, cook: 8, kcal: 900, protein: 34, spicy: 0, has_meat: 1, soup: 0, tag: "기본", desc: "두툼한 등심을 바삭하게 튀긴 정통 돈까스", img: null, emoji: "🍖", visible: true, ingredients: {"pork_loin": 1, "rice": 1} },
    { menu_id: 22, restaurant: "katsu", name: "치즈 돈까스", short: "치즈 돈까스", category: "돈까스", price: 7500, cook: 9, kcal: 1020, protein: 40, spicy: 0, has_meat: 1, soup: 0, tag: "치즈 쭉", desc: "모짜렐라가 쭉 늘어나는 치즈 돈까스", img: null, emoji: "🧀", visible: true, ingredients: {"pork_loin": 1, "cheese": 1, "rice": 1} },
    { menu_id: 23, restaurant: "katsu", name: "고구마치즈 돈까스", short: "고구마치즈", category: "돈까스", price: 7500, cook: 9, kcal: 1050, protein: 36, spicy: 0, has_meat: 1, soup: 0, tag: "달콤함", desc: "달콤한 고구마무스와 치즈를 채워", img: "sweetpotato-cheese-donkatsu.jpg", emoji: "🍠", visible: true, ingredients: {"pork_loin": 1, "cheese": 1, "rice": 1} },
    { menu_id: 24, restaurant: "katsu", name: "왕돈까스", short: "왕돈까스", category: "돈까스", price: 8000, cook: 9, kcal: 1100, protein: 42, spicy: 0, has_meat: 1, soup: 0, tag: "양 많음", desc: "접시를 덮는 큰 돈까스와 경양식 소스", img: null, emoji: "🍽️", visible: true, ingredients: {"pork_loin": 1.5, "rice": 1} },
    { menu_id: 25, restaurant: "katsu", name: "돈까스 카레", short: "돈까스 카레", category: "돈까스", price: 7000, cook: 8, kcal: 1000, protein: 33, spicy: 0, has_meat: 1, soup: 0, tag: "든든함", desc: "바삭한 돈까스 위에 카레를 듬뿍", img: "curry-donkatsu.jpg", emoji: "🍛", visible: true, ingredients: {"pork_loin": 1, "rice": 1} },
    { menu_id: 26, restaurant: "katsu", name: "가츠동", short: "가츠동", category: "돈까스", price: 6500, cook: 7, kcal: 880, protein: 32, spicy: 0, has_meat: 1, soup: 0, tag: "달걀 이불", desc: "돈까스를 간장 소스와 달걀로 부드럽게 덮어", img: null, emoji: "🍱", visible: true, ingredients: {"pork_loin": 1, "rice": 1, "egg": 1} },
    { menu_id: 27, restaurant: "katsu", name: "치킨까스", short: "치킨까스", category: "돈까스", price: 6500, cook: 8, kcal: 870, protein: 36, spicy: 0, has_meat: 1, soup: 0, tag: "부드러움", desc: "부드러운 닭가슴살을 바삭하게 튀겨", img: null, emoji: "🍗", visible: true, ingredients: {"chicken": 1, "rice": 1} },
    { menu_id: 28, restaurant: "katsu", name: "생선까스", short: "생선까스", category: "돈까스", price: 6500, cook: 7, kcal: 760, protein: 28, spicy: 0, has_meat: 0, soup: 0, tag: "타르타르", desc: "흰살생선 튀김에 상큼한 타르타르 소스", img: null, emoji: "🐟", visible: true, ingredients: {"seafood": 1, "rice": 1} },
    { menu_id: 29, restaurant: "snack", name: "치즈라면", short: "치즈라면", category: "분식", price: 4500, cook: 4, kcal: 620, protein: 20, spicy: 1, has_meat: 0, soup: 1, tag: "치즈 듬뿍", desc: "얼큰한 라면에 체다치즈 한 장", img: "cheese-ramen.jpg", emoji: "🍜", visible: true, ingredients: {"ramen": 1, "cheese": 1} },
    { menu_id: 30, restaurant: "snack", name: "떡볶이", short: "떡볶이", category: "분식", price: 4000, cook: 5, kcal: 520, protein: 10, spicy: 1, has_meat: 0, soup: 0, tag: "학교 앞 맛", desc: "쫀득한 쌀떡과 어묵, 달큰한 고추장 소스", img: "tteokbokki.jpg", emoji: "🌶️", visible: true, ingredients: {"tteok": 1} },
    { menu_id: 31, restaurant: "snack", name: "라볶이", short: "라볶이", category: "분식", price: 5000, cook: 5, kcal: 650, protein: 14, spicy: 1, has_meat: 0, soup: 0, tag: "라면 사리", desc: "떡볶이에 꼬불꼬불 라면 사리를 넣어", img: "rabokki.jpg", emoji: "🍝", visible: true, ingredients: {"tteok": 1, "ramen": 1} },
    { menu_id: 32, restaurant: "snack", name: "김밥", short: "김밥", category: "분식", price: 3500, cook: 2, kcal: 480, protein: 13, spicy: 0, has_meat: 1, soup: 0, tag: "가장 빨라요", desc: "햄, 단무지, 시금치를 넣은 기본 김밥", img: "gimbap.jpg", emoji: "🍙", visible: true, ingredients: {"gimbap": 1} },
    { menu_id: 33, restaurant: "snack", name: "참치김밥", short: "참치김밥", category: "분식", price: 4000, cook: 2, kcal: 540, protein: 18, spicy: 0, has_meat: 0, soup: 0, tag: "고소함", desc: "참치마요를 듬뿍 넣은 김밥", img: "tuna-gimbap.jpg", emoji: "🍙", visible: true, ingredients: {"gimbap": 1} },
    { menu_id: 34, restaurant: "snack", name: "모둠튀김", short: "모둠튀김", category: "분식", price: 4000, cook: 4, kcal: 560, protein: 9, spicy: 0, has_meat: 0, soup: 0, tag: "바삭함", desc: "김말이, 고구마, 오징어 튀김 모둠", img: "mixed-fry.jpg", emoji: "🍤", visible: true, ingredients: {"seafood": 0.3} },
    { menu_id: 35, restaurant: "snack", name: "순대", short: "순대", category: "분식", price: 4000, cook: 3, kcal: 500, protein: 18, spicy: 0, has_meat: 1, soup: 0, tag: "쫄깃함", desc: "쫄깃한 찰순대와 간, 허파를 함께", img: "sundae.jpg", emoji: "🌭", visible: true, ingredients: {"pork": 0.5} },
    { menu_id: 36, restaurant: "snack", name: "오므라이스", short: "오므라이스", category: "분식", price: 5500, cook: 5, kcal: 720, protein: 21, spicy: 0, has_meat: 1, soup: 0, tag: "부드러움", desc: "케첩 볶음밥을 부드러운 달걀로 감싸", img: "cheese-omurice.jpg", emoji: "🍳", visible: true, ingredients: {"rice": 1, "egg": 2} },
    { menu_id: 37, restaurant: "soup", name: "돼지국밥", short: "돼지국밥", category: "국물", price: 6500, cook: 4, kcal: 680, protein: 35, spicy: 0, has_meat: 1, soup: 1, tag: "진한 육수", desc: "뽀얀 돼지 사골 육수에 수육을 듬뿍", img: null, emoji: "🍲", visible: true, ingredients: {"rice": 1, "pork": 1, "broth": 0.7} },
    { menu_id: 38, restaurant: "soup", name: "순대국밥", short: "순대국밥", category: "국물", price: 6500, cook: 4, kcal: 700, protein: 32, spicy: 0, has_meat: 1, soup: 1, tag: "든든함", desc: "순대와 머리고기를 넣은 얼큰한 국밥", img: null, emoji: "🍲", visible: true, ingredients: {"rice": 1, "pork": 1, "broth": 0.7} },
    { menu_id: 39, restaurant: "soup", name: "김치찌개", short: "김치찌개", category: "국물", price: 6000, cook: 6, kcal: 560, protein: 26, spicy: 1, has_meat: 1, soup: 1, tag: "집밥 맛", desc: "돼지고기와 묵은지를 푹 끓인 김치찌개", img: null, emoji: "🥘", visible: true, ingredients: {"rice": 1, "pork": 0.5, "tofu": 0.5, "broth": 0.5} },
    { menu_id: 40, restaurant: "soup", name: "된장찌개", short: "된장찌개", category: "국물", price: 5500, cook: 6, kcal: 450, protein: 20, spicy: 0, has_meat: 0, soup: 1, tag: "구수함", desc: "두부와 애호박을 넣은 구수한 된장찌개", img: null, emoji: "🥘", visible: true, ingredients: {"rice": 1, "tofu": 0.5, "broth": 0.5} },
    { menu_id: 41, restaurant: "soup", name: "부대찌개", short: "부대찌개", category: "국물", price: 6500, cook: 7, kcal: 720, protein: 30, spicy: 1, has_meat: 1, soup: 1, tag: "푸짐함", desc: "햄, 소시지, 라면 사리를 넣어 칼칼하게", img: null, emoji: "🍲", visible: true, ingredients: {"rice": 1, "pork": 0.5, "ramen": 0.5, "broth": 0.5} },
    { menu_id: 42, restaurant: "soup", name: "순두부찌개", short: "순두부찌개", category: "국물", price: 6000, cook: 6, kcal: 480, protein: 22, spicy: 1, has_meat: 0, soup: 1, tag: "보들보들", desc: "바지락과 순두부를 넣은 얼큰한 찌개", img: null, emoji: "🥘", visible: true, ingredients: {"rice": 1, "tofu": 1, "seafood": 0.3, "egg": 1} },
    { menu_id: 43, restaurant: "soup", name: "육개장", short: "육개장", category: "국물", price: 6500, cook: 6, kcal: 520, protein: 30, spicy: 1, has_meat: 1, soup: 1, tag: "얼큰함", desc: "소고기와 대파, 고사리를 넣고 푹 끓여", img: null, emoji: "🍲", visible: true, ingredients: {"rice": 1, "beef": 1, "broth": 0.7} },
    { menu_id: 44, restaurant: "soup", name: "갈비탕", short: "갈비탕", category: "국물", price: 8000, cook: 5, kcal: 640, protein: 38, spicy: 0, has_meat: 1, soup: 1, tag: "보양식", desc: "부드러운 소갈비를 맑게 끓인 갈비탕", img: "galbitang.jpg", emoji: "🍖", visible: true, ingredients: {"rice": 1, "beef": 1.5, "broth": 0.7} },
    { menu_id: 45, restaurant: "soup", name: "소고기미역국", short: "미역국", category: "국물", price: 5500, cook: 4, kcal: 420, protein: 24, spicy: 0, has_meat: 1, soup: 1, tag: "담백함", desc: "참기름에 볶은 소고기와 미역을 끓여", img: null, emoji: "🥣", visible: true, ingredients: {"rice": 1, "beef": 0.5, "broth": 0.5} }
  ];

  /* ---------- 재고 (발주 관리) : base는 오늘 아침 입고 기준 ---------- */
  var DEFAULT_INVENTORY = [
    { id: "rice", name: "쌀밥", unit: "공기", base: 160, safety: 60 },
    { id: "pork_loin", name: "돈까스 등심", unit: "장", base: 30, safety: 12 },
    { id: "pork", name: "돼지고기", unit: "인분", base: 40, safety: 15 },
    { id: "pork_belly", name: "대패 삼겹", unit: "인분", base: 30, safety: 12 },
    { id: "beef", name: "소고기", unit: "인분", base: 30, safety: 12 },
    { id: "chicken", name: "닭고기", unit: "인분", base: 30, safety: 12 },
    { id: "chicken_leg", name: "닭다리", unit: "개", base: 16, safety: 10 },
    { id: "seafood", name: "해산물", unit: "인분", base: 20, safety: 8 },
    { id: "noodle", name: "밀면", unit: "인분", base: 50, safety: 20 },
    { id: "rice_noodle", name: "쌀국수 면", unit: "인분", base: 20, safety: 10 },
    { id: "dumpling", name: "손만두", unit: "개", base: 60, safety: 30 },
    { id: "broth", name: "육수", unit: "L", base: 40, safety: 15 },
    { id: "tofu", name: "두부·순두부", unit: "팩", base: 14, safety: 10 },
    { id: "ramen", name: "라면", unit: "봉", base: 40, safety: 15 },
    { id: "tteok", name: "떡", unit: "인분", base: 25, safety: 10 },
    { id: "gimbap", name: "김밥 재료", unit: "줄", base: 25, safety: 10 },
    { id: "egg", name: "달걀", unit: "개", base: 120, safety: 40 },
    { id: "cheese", name: "치즈", unit: "장", base: 30, safety: 10 }
  ];

  var DEFAULT_HOURS = {
    lunch: { open: '11:00', close: '14:00' },
    dinner: { open: '17:00', close: '19:00' },
    closedToday: false,
    reserveCutoff: 10,
    notice: ''
  };

  /* predict.py가 15분 단위로 계산한 '평소 수요일' 예상 대기(분). 학사일정 계수를 곱해 씀 */
  var BASE_TIMELINE = [
    { t: '11:30', w: 6 }, { t: '11:40', w: 8 }, { t: '11:50', w: 11 }, { t: '12:00', w: 14 }, { t: '12:10', w: 17 },
    { t: '12:20', w: 18 }, { t: '12:30', w: 12 }, { t: '12:40', w: 3 }, { t: '12:50', w: 4 }, { t: '13:00', w: 7 },
    { t: '13:10', w: 8 }, { t: '13:20', w: 6 }, { t: '13:30', w: 4 }, { t: '13:40', w: 3 }, { t: '13:50', w: 3 }
  ];

  var DEFAULT_AI = {
    examPeriod: false,     // 시험기간: 수업이 줄어 점심이 분산됨 → 피크 대기 감소(가정)
    campusEvent: false,    // 교내 행사: 외부 방문객 → 대기 증가
    rain: false,           // 비: 교외 식사 감소 → 대기 증가
    stations: 2            // 동시에 조리하는 인원
  };
  var FACTORS = { examPeriod: 0.85, campusEvent: 1.3, rain: 1.15 };

  var DEFAULT_PROFILE = {
    name: '준영',
    dailyGoal: 2000,
    avoid: [],
    spicy: '좋아요',
    meals: [{ label: '아침 · 편의점 샌드위치', kcal: 420, time: '08:40' }],
    history: [
      { daysAgo: 1, menu_id: 5 },
      { daysAgo: 2, menu_id: 6 },
      { daysAgo: 3, menu_id: 2 },
      { daysAgo: 6, menu_id: 5 }
    ]
  };

  /* ---------- 저장소 헬퍼 ---------- */
  function readRaw(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function writeRaw(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } }
  function removeKey(key) { try { localStorage.removeItem(key); } catch (e) { /* 저장소 사용 불가 */ } }
  function readJSON(key, fallback) {
    var raw = readRaw(key);
    if (raw === null || raw === undefined) { return fallback; }
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }
  function writeJSON(key, value) { return writeRaw(key, JSON.stringify(value)); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  /* ---------- 공통 포맷 ---------- */
  function pad2(n) { return String(n).padStart(2, '0'); }
  function hhmm(ts) { var d = new Date(ts); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function won(n) { return Math.round(n).toLocaleString('ko-KR') + '원'; }
  function orderNo(n) { return 'A-' + String(n).padStart(3, '0'); }
  function toMinutes(t) { var p = t.split(':'); return Number(p[0]) * 60 + Number(p[1]); }
  function minutesOfDay(ts) { var d = new Date(ts); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }

  /* ---------- 데모 시계 (POS 하단 '15분 경과'와 공유) ---------- */
  function startOffset() {
    var p = DEMO_START.split(':');
    var t = new Date(); t.setHours(Number(p[0]), Number(p[1]), 0, 0);
    return t.getTime() - Date.now();
  }
  function getDemoOffset() {
    var raw = readRaw(KEYS.demoOffset);
    var n = Number(raw);
    if (raw === null || isNaN(n)) { n = startOffset(); writeRaw(KEYS.demoOffset, String(n)); }
    return n;
  }
  function demoNow() { return Date.now() + getDemoOffset(); }

  /* ---------- 메뉴 ---------- */
  function getMenus() {
    var saved = readJSON(KEYS.menus, null);
    var list = Array.isArray(saved) && saved.length ? saved : clone(DEFAULT_MENUS);
    var sold = getSoldOut();
    var rests = {};
    getRestaurants().forEach(function (r) { rests[r.id] = r; });
    return list.map(function (m) {
      var d = DEFAULT_MENUS.find(function (x) { return x.menu_id === m.menu_id; }) || {};
      var merged = Object.assign({}, d, m);
      merged.sold_out = sold[merged.menu_id] === true;
      merged.image = merged.img ? IMG_BASE + merged.img : null;
      merged.cook_minutes = merged.cook;
      var r = rests[merged.restaurant] || {};
      merged.restaurantName = r.name || '';
      merged.restaurantOpen = r.open !== false;
      merged.tone = r.tone || ['#F2F4F6', '#E5E8EB'];
      merged.orderable = merged.visible !== false && !merged.sold_out && merged.restaurantOpen;
      return merged;
    });
  }
  function saveMenus(list) {
    writeJSON(KEYS.menus, list.map(function (m) {
      var o = Object.assign({}, m);
      ['sold_out', 'image', 'cook_minutes', 'restaurantName', 'restaurantOpen', 'tone', 'orderable'].forEach(function (k) { delete o[k]; });
      return o;
    }));
  }
  /* ---------- 식당 ---------- */
  function getRestaurants() {
    var saved = readJSON(KEYS.restaurants, {}) || {};
    return RESTAURANTS.map(function (r) {
      var o = Object.assign({}, r, saved[r.id] || {});
      o.coverImage = o.cover ? IMG_BASE + (DEFAULT_MENUS.find(function (m) { return m.menu_id === o.cover; }) || {}).img : null;
      return o;
    });
  }
  function setRestaurantOpen(id, open) {
    var saved = readJSON(KEYS.restaurants, {}) || {};
    saved[id] = Object.assign({}, saved[id] || {}, { open: !!open });
    writeJSON(KEYS.restaurants, saved);
  }
  function restaurantById(id) { return getRestaurants().find(function (r) { return r.id === id; }); }

  function getSoldOut() { return readJSON(KEYS.soldOut, {}) || {}; }
  function setSoldOut(map) { writeJSON(KEYS.soldOut, map); }
  function menuById(id) { return getMenus().find(function (m) { return m.menu_id === Number(id); }); }
  function menuByName(name) { return getMenus().find(function (m) { return m.name === name; }); }

  /* ---------- 주문 ---------- */
  function getOrders() { var o = readJSON(KEYS.orders, []); return Array.isArray(o) ? o : []; }
  function saveOrders(list) { writeJSON(KEYS.orders, list); }
  function issueOrderNumber(existing) {
    var orders = existing || getOrders();
    var seq = FIRST_ORDER_NUMBER;
    var stored = parseInt(readRaw(KEYS.seq), 10);
    if (!isNaN(stored)) { seq = Math.max(stored, FIRST_ORDER_NUMBER); }
    var maxExisting = orders.reduce(function (m, o) { return Math.max(m, o.order_number); }, 0);
    seq = Math.max(seq, maxExisting + 1);
    writeRaw(KEYS.seq, String(seq + 1));
    return seq;
  }
  function expectedCook(order) {
    var menus = getMenus();
    var max = Math.max.apply(null, order.items.map(function (i) {
      var m = menus.find(function (x) { return x.name === i.menu_name; }); return m ? m.cook : 5;
    }));
    var qty = order.items.reduce(function (s, i) { return s + i.quantity; }, 0);
    return max + Math.floor((qty - 1) / 2);
  }
  function itemOf(name, qty) {
    var m = DEFAULT_MENUS.find(function (x) { return x.name === name; });
    var live = menuByName(name) || m;
    return { menu_id: live.menu_id, menu_name: live.name, quantity: qty, unit_price: live.price, total_price: live.price * qty };
  }

  /* ---------- 시연 데이터: 16건 / 99,000원 / 모바일 9 · 키오스크 7 ---------- */
  function buildSeed() {
    var now = demoNow();
    function mk(no, channel, items, status, ago, extra) {
      var orderTime = now - ago * MIN;
      var o = {
        order_number: no, items: items, total_price: items.reduce(function (s, i) { return s + i.total_price; }, 0),
        order_status: status, order_time: orderTime, channel: channel,
        payment_method: channel === '모바일' ? (no % 2 ? '토스페이' : '카카오페이') : (no % 2 ? '신용·체크카드' : '학생증'),
        pickup_type: 'NOW', pos_ingested: true
      };
      var cook = Math.max.apply(null, items.map(function (i) { var m = DEFAULT_MENUS.find(function (x) { return x.name === i.menu_name; }); return m.cook; }));
      if (status !== 'WAITING' && status !== 'CANCELED') { o.cook_started_at = orderTime + 2 * MIN; }
      if (status === 'READY' || status === 'PICKED_UP') { o.ready_at = o.cook_started_at + cook * MIN; }
      if (status === 'PICKED_UP') { o.picked_at = o.ready_at + 2 * MIN; }
      if (status === 'CANCELED') { o.canceled_at = orderTime + MIN; }
      return Object.assign(o, extra || {});
    }
    var KAL = '사골 손칼만두', BIB = '대패 마늘쫑 비빔밥', PHO = '통닭다리 쌀국수', GYU = '온천달걀 규동', DON = '매콤 양념 돈까스', RAM = '뚝배기 순두부 라면';
    var I = function (n) { var m = DEFAULT_MENUS.find(function (x) { return x.name === n; }); return { menu_id: m.menu_id, menu_name: n, quantity: 1, unit_price: m.price, total_price: m.price }; };
    return [
      mk(85, '키오스크', [I(DON)], 'CANCELED', 50),
      mk(86, '모바일', [I(BIB)], 'PICKED_UP', 48),
      mk(87, '키오스크', [I(RAM)], 'PICKED_UP', 45),
      mk(88, '모바일', [I(PHO)], 'PICKED_UP', 42),
      mk(89, '키오스크', [I(GYU)], 'PICKED_UP', 40),
      mk(90, '모바일', [I(RAM)], 'PICKED_UP', 37),
      mk(91, '모바일', [I(KAL)], 'PICKED_UP', 34, { pickup_type: 'RESERVED', pickup_time: '11:50', ai_reserved: true, ai_saved_minutes: 6 }),
      mk(92, '키오스크', [I(PHO)], 'PICKED_UP', 31),
      mk(93, '모바일', [I(RAM)], 'PICKED_UP', 28),
      mk(94, '키오스크', [I(GYU)], 'PICKED_UP', 25),
      mk(95, '모바일', [I(RAM)], 'PICKED_UP', 22, { pickup_type: 'RESERVED', pickup_time: '12:05', ai_reserved: true, ai_saved_minutes: 5 }),
      mk(96, '모바일', [I(DON)], 'READY', 17, { cook_started_at: now - 13 * MIN, ready_at: now - 3 * MIN }),
      mk(97, '키오스크', [I(DON), I(RAM)], 'READY', 15, { cook_started_at: now - 11 * MIN, ready_at: now - 1 * MIN }),
      mk(98, '모바일', [I(BIB)], 'COOKING', 11, { cook_started_at: now - 4 * MIN }),
      mk(99, '키오스크', [I(PHO)], 'COOKING', 9, { cook_started_at: now - 2 * MIN }),
      mk(100, '모바일', [I(GYU)], 'WAITING', 4, { pickup_type: 'RESERVED', pickup_time: '13:00', ai_reserved: true, ai_saved_minutes: 6 }),
      mk(101, '키오스크', [I(KAL)], 'WAITING', 1)
    ];
  }

  /* 처음 열었거나 데이터 버전이 바뀌면 시연 데이터를 채움 (세 프로그램 공통) */
  function ensureSeed() {
    if (readRaw(KEYS.version) === DATA_VERSION && readRaw(KEYS.orders) !== null) { return false; }
    resetDemo();
    return true;
  }
  function resetDemo() {
    removeKey(KEYS.orders);
    writeRaw(KEYS.demoOffset, String(startOffset()));
    saveOrders(buildSeed());
    setSoldOut({});
    writeRaw(KEYS.seq, String(FIRST_ORDER_NUMBER));
    removeKey(KEYS.menus);
    removeKey(KEYS.restaurants);
    removeKey(KEYS.purchases);
    writeJSON(KEYS.aiStats, { questions: 7, llm: 0, rule: 7 });
    writeJSON(KEYS.hours, DEFAULT_HOURS);
    writeJSON(KEYS.aiConfig, DEFAULT_AI);
    writeRaw(KEYS.version, DATA_VERSION);
  }

  /* ---------- 영업시간 ---------- */
  function getHours() { return Object.assign(clone(DEFAULT_HOURS), readJSON(KEYS.hours, {}) || {}); }
  function saveHours(h) { writeJSON(KEYS.hours, h); }
  function openState(ts) {
    var h = getHours();
    var now = minutesOfDay(ts || demoNow());
    if (h.closedToday) { return { open: false, label: '오늘은 쉬어요', until: null, next: null }; }
    var slots = [['점심', h.lunch], ['저녁', h.dinner]];
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i][1];
      if (!s || !s.open || !s.close) { continue; }
      if (now >= toMinutes(s.open) && now < toMinutes(s.close)) {
        return { open: true, label: slots[i][0] + ' 영업 중', until: s.close, next: null };
      }
    }
    var upcoming = slots.filter(function (x) { return x[1] && toMinutes(x[1].open) > now; })[0];
    return { open: false, label: '영업 준비 중', until: null, next: upcoming ? upcoming[1].open : null };
  }

  /* ---------- AI 대기 예측 ---------- */
  function getAIConfig() { return Object.assign(clone(DEFAULT_AI), readJSON(KEYS.aiConfig, {}) || {}); }
  function saveAIConfig(c) { writeJSON(KEYS.aiConfig, c); }
  function factorOf(cfg) {
    var f = 1;
    Object.keys(FACTORS).forEach(function (k) { if (cfg[k]) { f *= FACTORS[k]; } });
    return f;
  }
  /* predict.py가 만든 shared/forecast.js가 있으면 모델 예측을 그대로 쓰고, 없을 때만 예비 표 × 계수를 씀 */
  function forecastInfo() { return global.MJC_FORECAST && global.MJC_FORECAST.timelines ? global.MJC_FORECAST : null; }
  function timeline(cfg) {
    var c = cfg || getAIConfig();
    var fc = forecastInfo();
    var key = (c.examPeriod ? '1' : '0') + (c.campusEvent ? '1' : '0') + (c.rain ? '1' : '0');
    if (fc && fc.timelines[key]) {
      return fc.timelines[key].map(function (p) { return { t: p.t, w: p.w, level: p.level }; });
    }
    var f = factorOf(c);
    return BASE_TIMELINE.map(function (p) { return { t: p.t, w: Math.max(2, Math.round(p.w * f)) }; });
  }
  function timelineAt(tl, minute) {
    var pts = tl.map(function (p) { return { m: toMinutes(p.t), w: p.w }; });
    if (minute <= pts[0].m) { return pts[0].w; }
    for (var i = 1; i < pts.length; i++) {
      if (minute <= pts[i].m) {
        var a = pts[i - 1], b = pts[i];
        return a.w + (b.w - a.w) * (minute - a.m) / (b.m - a.m);
      }
    }
    return pts[pts.length - 1].w;
  }
  function liveQueueMinutes(now, cfg) {
    var remain = 0;
    getOrders().forEach(function (o) {
      if (o.order_status !== 'WAITING' && o.order_status !== 'COOKING') { return; }
      var cook = expectedCook(o);
      if (o.order_status === 'COOKING' && o.cook_started_at) {
        remain += Math.max(1, cook - (now - o.cook_started_at) / MIN);
      } else { remain += cook; }
    });
    return remain / Math.max(1, cfg.stations || 2);
  }
  /* 식당(주방)별 남은 조리 시간(분): 식당마다 주방이 따로라 대기가 다르게 쌓임 */
  function restaurantQueues(now) {
    var menus = getMenus();
    var q = {};
    RESTAURANTS.forEach(function (r) { q[r.id] = 0; });
    getOrders().forEach(function (o) {
      if (o.order_status !== 'WAITING' && o.order_status !== 'COOKING') { return; }
      var elapsed = o.order_status === 'COOKING' && o.cook_started_at ? (now - o.cook_started_at) / MIN : 0;
      o.items.forEach(function (i) {
        var m = menus.find(function (x) { return x.name === i.menu_name; });
        if (!m) { return; }
        var total = m.cook * (1 + 0.5 * (i.quantity - 1));
        q[m.restaurant] = (q[m.restaurant] || 0) + Math.max(o.order_status === 'COOKING' ? 1 : 0, total - elapsed);
      });
    });
    Object.keys(q).forEach(function (k) { q[k] = Math.round(q[k]); });
    return q;
  }

  function predict(ts) {
    var now = ts || demoNow();
    var cfg = getAIConfig();
    var tl = timeline(cfg);
    var minute = minutesOfDay(now);
    var modelWait = timelineAt(tl, minute);
    var queue = liveQueueMinutes(now, cfg);
    var current = Math.max(3, Math.round(0.6 * modelWait + 0.4 * (queue + 5)));
    var level = current >= 15 ? '혼잡' : current >= 8 ? '보통' : '원활';
    var source = forecastInfo() ? 'model' : 'fallback';
    if (source === 'model') {
      /* 혼잡도 = 모델 분류 결과, 단 지금 주방 대기열이 길면 한 단계 올림 */
      var LV = ['원활', '보통', '혼잡'];
      var slot = tl.filter(function (p) { return toMinutes(p.t) <= minute; }).pop() || tl[0];
      var idx = Math.max(0, LV.indexOf(slot.level));
      if (queue >= 12 && idx < 2) { idx += 1; }
      level = LV[idx];
    }
    var hours = getHours();
    var close = toMinutes(hours.lunch.close);
    var candidates = tl.filter(function (p) { var m = toMinutes(p.t); return m >= minute + 10 && m < close; });
    /* 추천 시각: 지금보다 대기가 충분히(40% 이상) 줄어드는 가장 이른 시각, 없으면 가장 덜 붐비는 시각 */
    var goal = Math.max(3, Math.round(current * 0.6));
    var best = candidates.filter(function (p) { return p.w <= goal; })[0] ||
      candidates.reduce(function (b, p) { return !b || p.w < b.w ? p : b; }, null);
    return {
      currentWait: current, level: level, modelWait: Math.round(modelWait), queueMinutes: Math.round(queue),
      common: Math.max(2, Math.round(modelWait * 0.45)), queues: restaurantQueues(now),
      recTime: best ? best.t : null, recWait: best ? best.w : null,
      saving: best ? Math.max(0, current - best.w) : 0,
      timeline: tl, factors: cfg, factor: factorOf(cfg), nowMinute: minute, source: source
    };
  }
  /* 메뉴별 예상 수령 시간 = 공통 혼잡(AI 시간대 예측) + 그 식당 주방의 대기열 + 메뉴 조리 시간 */
  function menuWait(menu, pred) {
    var p = pred || predict();
    return p.common + (p.queues[menu.restaurant] || 0) + menu.cook;
  }
  function restaurantWait(rid, pred) {
    var p = pred || predict();
    var list = getMenus().filter(function (m) { return m.restaurant === rid && m.visible !== false; });
    var cooks = list.map(function (m) { return m.cook; }).sort(function (a, b) { return a - b; });
    var median = cooks.length ? cooks[Math.floor(cooks.length / 2)] : 5;
    return p.common + (p.queues[rid] || 0) + median;
  }

  /* ---------- AI 사용 통계 (관리자 대시보드 'AI 효과') ---------- */
  function getAIStats() { return Object.assign({ questions: 0, llm: 0, rule: 0 }, readJSON(KEYS.aiStats, {}) || {}); }
  function bumpAIStats(engine) {
    var st = getAIStats();
    st.questions += 1;
    if (engine === 'llm') { st.llm += 1; } else { st.rule += 1; }
    writeJSON(KEYS.aiStats, st);
  }
  function aiImpact() {
    var orders = getOrders().filter(function (o) { return o.order_status !== 'CANCELED'; });
    var reserved = orders.filter(function (o) { return o.ai_reserved; });
    var saved = reserved.reduce(function (s, o) { return s + (o.ai_saved_minutes || 0); }, 0);
    return { reserved: reserved.length, saved: saved, share: orders.length ? reserved.length / orders.length : 0, viaAI: orders.filter(function (o) { return o.via_ai; }).length, stats: getAIStats() };
  }

  /* ---------- 데모 로그인 (이 기기에만 저장, 실제 인증은 2단계에서 Supabase Auth로) ---------- */
  function session() { return readJSON(KEYS.session, null); }
  function isMember() { var s = session(); return !!(s && s.member); }
  function login() { writeJSON(KEYS.session, { member: true, name: DEFAULT_PROFILE.name, since: Date.now() }); }
  function logout() { removeKey(KEYS.session); }

  /* ---------- 재고·발주 ---------- */
  function getPurchases() { var p = readJSON(KEYS.purchases, []); return Array.isArray(p) ? p : []; }
  function savePurchases(list) { writeJSON(KEYS.purchases, list); }
  function inventory() {
    var menus = getMenus();
    var used = {};
    getOrders().forEach(function (o) {
      if (o.order_status === 'CANCELED') { return; }
      o.items.forEach(function (i) {
        var m = menus.find(function (x) { return x.name === i.menu_name; });
        if (!m || !m.ingredients) { return; }
        Object.keys(m.ingredients).forEach(function (k) { used[k] = (used[k] || 0) + m.ingredients[k] * i.quantity; });
      });
    });
    var received = {};
    getPurchases().forEach(function (p) { if (p.status === 'RECEIVED') { received[p.ingredient] = (received[p.ingredient] || 0) + p.qty; } });
    return DEFAULT_INVENTORY.map(function (it) {
      var stock = Math.round((it.base - (used[it.id] || 0) + (received[it.id] || 0)) * 10) / 10;
      var pending = getPurchases().filter(function (p) { return p.ingredient === it.id && p.status === 'REQUESTED'; })
        .reduce(function (s, p) { return s + p.qty; }, 0);
      var need = stock < it.safety;
      var suggest = Math.max(0, Math.ceil(it.safety * 2 - stock - pending));
      var usedBy = menus.filter(function (m) { return m.ingredients && m.ingredients[it.id]; }).map(function (m) { return m.short; });
      return Object.assign({}, it, { used: Math.round((used[it.id] || 0) * 10) / 10, stock: stock, pending: pending, need: need, suggest: suggest, usedBy: usedBy });
    });
  }

  /* ---------- 학생 프로필 (이 기기에만 저장) ---------- */
  function getProfile() { return Object.assign(clone(DEFAULT_PROFILE), readJSON(KEYS.profile, {}) || {}); }
  function saveProfile(p) { writeJSON(KEYS.profile, p); }
  function myOrders() { return getOrders().filter(function (o) { return o.customer === 'me'; }); }
  function todayIntake() {
    var p = getProfile();
    var menus = getMenus();
    var meals = p.meals.slice();
    myOrders().forEach(function (o) {
      if (o.order_status === 'CANCELED') { return; }
      o.items.forEach(function (i) {
        var m = menus.find(function (x) { return x.name === i.menu_name; });
        meals.push({ label: '학식 · ' + i.menu_name + (i.quantity > 1 ? ' ' + i.quantity + '개' : ''), kcal: (m ? m.kcal : 0) * i.quantity, time: hhmm(o.order_time), fromOrder: true });
      });
    });
    var total = meals.reduce(function (s, m) { return s + m.kcal; }, 0);
    return { meals: meals, total: total, goal: p.dailyGoal, remain: p.dailyGoal - total };
  }

  global.Store = {
    MIN: MIN, KEYS: KEYS, DATA_VERSION: DATA_VERSION, FIRST_ORDER_NUMBER: FIRST_ORDER_NUMBER,
    DEFAULT_MENUS: DEFAULT_MENUS, DEFAULT_INVENTORY: DEFAULT_INVENTORY, FACTORS: FACTORS, IMG_BASE: IMG_BASE,
    readRaw: readRaw, writeRaw: writeRaw, removeKey: removeKey, readJSON: readJSON, writeJSON: writeJSON,
    pad2: pad2, hhmm: hhmm, won: won, orderNo: orderNo, toMinutes: toMinutes,
    getDemoOffset: getDemoOffset, demoNow: demoNow,
    getMenus: getMenus, saveMenus: saveMenus, getSoldOut: getSoldOut, setSoldOut: setSoldOut, menuById: menuById, menuByName: menuByName,
    getOrders: getOrders, saveOrders: saveOrders, issueOrderNumber: issueOrderNumber, expectedCook: expectedCook, itemOf: itemOf,
    buildSeed: buildSeed, ensureSeed: ensureSeed, resetDemo: resetDemo,
    getHours: getHours, saveHours: saveHours, openState: openState,
    getAIConfig: getAIConfig, saveAIConfig: saveAIConfig, timeline: timeline, predict: predict, menuWait: menuWait, restaurantWait: restaurantWait, restaurantQueues: restaurantQueues,
    RESTAURANTS: RESTAURANTS, forecastInfo: forecastInfo, getRestaurants: getRestaurants, setRestaurantOpen: setRestaurantOpen, restaurantById: restaurantById,
    session: session, isMember: isMember, login: login, logout: logout,
    getAIStats: getAIStats, bumpAIStats: bumpAIStats, aiImpact: aiImpact,
    getPurchases: getPurchases, savePurchases: savePurchases, inventory: inventory,
    getProfile: getProfile, saveProfile: saveProfile, myOrders: myOrders, todayIntake: todayIntake
  };
})(window);
