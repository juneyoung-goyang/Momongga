-- =====================================================================
--  학생식당 스마트오더 & 실시간 혼잡도 예측 POS 시스템
--  schema.sql  (MySQL 8.0.16 이상 권장 / CHECK 제약조건 사용)
--  실행: mysql -u root -p < schema.sql
-- =====================================================================

CREATE DATABASE IF NOT EXISTS smart_cafeteria
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;

USE smart_cafeteria;

SET NAMES utf8mb4;
SET time_zone = '+09:00';

-- 재실행 시 FK 순서 문제를 피하기 위해 자식 테이블부터 삭제
DROP VIEW  IF EXISTS v_today_order_summary;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS congestion;
DROP TABLE IF EXISTS menus;
DROP TABLE IF EXISTS restaurants;

-- ---------------------------------------------------------------------
-- 1. restaurants : 학생식당 안의 식당(코너) 5곳
-- ---------------------------------------------------------------------
CREATE TABLE restaurants (
    restaurant_id VARCHAR(20)  NOT NULL                COMMENT '식당 ID',
    name          VARCHAR(30)  NOT NULL                COMMENT '식당 이름',
    category      VARCHAR(20)  NOT NULL                COMMENT '주 카테고리',
    description   VARCHAR(100) NULL                    COMMENT '소개',
    is_open       TINYINT(1)   NOT NULL DEFAULT 1      COMMENT '오늘 영업 여부',
    PRIMARY KEY (restaurant_id)
) ENGINE = InnoDB COMMENT = '식당(코너)';

INSERT INTO restaurants (restaurant_id, name, category, description, is_open) VALUES
    ('rice', '한그릇 덮밥', '밥', '갓 지은 밥 위에 든든한 한 그릇', 1),
    ('noodle', '면 공방', '면', '매일 뽑는 면과 진한 육수', 1),
    ('katsu', '바삭 돈까스', '돈까스', '주문하면 바로 튀기는 두툼한 돈까스', 1),
    ('snack', '분식 스테이션', '분식', '빠르고 가볍게, 학교 앞 분식 그대로', 1),
    ('soup', '든든 국밥', '국물', '뚝배기에 바로 끓여 내는 국밥과 찌개', 1);

-- ---------------------------------------------------------------------
-- 2. menus : 메뉴 마스터 45개 (학생 앱 메뉴판 / POS 품절 관리)
-- ---------------------------------------------------------------------
CREATE TABLE menus (
    menu_id             INT          NOT NULL                COMMENT '메뉴 ID',
    restaurant_id       VARCHAR(20)  NOT NULL                COMMENT '식당 ID',
    name                VARCHAR(50)  NOT NULL                COMMENT '메뉴명',
    price               INT          NOT NULL                COMMENT '판매가(원)',
    category            VARCHAR(20)  NOT NULL                COMMENT '카테고리(밥/면/돈까스/분식/국물)',
    is_sold_out         TINYINT(1)   NOT NULL DEFAULT 0      COMMENT '품절 여부 (0=판매중, 1=품절)',
    estimated_cook_time INT          NOT NULL DEFAULT 5      COMMENT '예상 조리시간(분)',
    kcal                INT          NOT NULL DEFAULT 0      COMMENT '열량(추정)',
    protein_g           INT          NOT NULL DEFAULT 0      COMMENT '단백질 g(추정)',
    is_spicy            TINYINT(1)   NOT NULL DEFAULT 0      COMMENT '매운 메뉴',
    has_meat            TINYINT(1)   NOT NULL DEFAULT 0      COMMENT '고기 포함',
    has_soup            TINYINT(1)   NOT NULL DEFAULT 0      COMMENT '국물 있음',
    PRIMARY KEY (menu_id),
    UNIQUE KEY uk_menus_name (name),
    KEY idx_menus_restaurant (restaurant_id),
    CONSTRAINT fk_menus_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants (restaurant_id),
    CONSTRAINT chk_menus_price    CHECK (price >= 0),
    CONSTRAINT chk_menus_category CHECK (category IN ('밥', '면', '돈까스', '분식', '국물')),
    CONSTRAINT chk_menus_cooktime CHECK (estimated_cook_time BETWEEN 1 AND 60)
) ENGINE = InnoDB COMMENT = '메뉴 마스터';

INSERT INTO menus (menu_id, restaurant_id, name, price, category, is_sold_out, estimated_cook_time, kcal, protein_g, is_spicy, has_meat, has_soup) VALUES
    (1, 'noodle', '사골 손칼만두', 6000, '면', 0, 7, 650, 27, 0, 1, 1),
    (2, 'rice', '대패 마늘쫑 비빔밥', 6500, '밥', 0, 5, 780, 33, 1, 1, 0),
    (3, 'noodle', '통닭다리 쌀국수', 6500, '면', 0, 6, 610, 41, 0, 1, 1),
    (4, 'rice', '온천달걀 규동', 6000, '밥', 0, 5, 820, 34, 0, 1, 0),
    (5, 'katsu', '매콤 양념 돈까스', 7000, '돈까스', 0, 8, 950, 35, 1, 1, 0),
    (6, 'snack', '뚝배기 순두부 라면', 4500, '분식', 0, 4, 600, 19, 1, 0, 1),
    (7, 'rice', '제육덮밥', 5500, '밥', 0, 5, 760, 30, 1, 1, 0),
    (8, 'rice', '치킨마요덮밥', 5000, '밥', 0, 4, 720, 28, 0, 1, 0),
    (9, 'rice', '참치마요덮밥', 4500, '밥', 0, 3, 650, 22, 0, 0, 0),
    (10, 'rice', '김치볶음밥', 5000, '밥', 0, 5, 690, 18, 1, 1, 0),
    (11, 'rice', '카레라이스', 5000, '밥', 0, 3, 700, 16, 0, 1, 0),
    (12, 'rice', '불고기덮밥', 6000, '밥', 0, 5, 740, 32, 0, 1, 0),
    (13, 'rice', '오징어덮밥', 6000, '밥', 0, 6, 680, 29, 1, 0, 0),
    (14, 'noodle', '잔치국수', 4000, '면', 0, 4, 480, 14, 0, 0, 1),
    (15, 'noodle', '비빔국수', 4500, '면', 0, 4, 560, 13, 1, 0, 0),
    (16, 'noodle', '냉모밀', 5500, '면', 0, 4, 520, 17, 0, 0, 1),
    (17, 'noodle', '짜장면', 5000, '면', 0, 6, 780, 20, 0, 1, 0),
    (18, 'noodle', '짬뽕', 6000, '면', 0, 7, 690, 28, 1, 1, 1),
    (19, 'noodle', '우동', 5000, '면', 0, 5, 520, 16, 0, 0, 1),
    (20, 'noodle', '쫄면', 5000, '면', 0, 4, 600, 15, 1, 0, 0),
    (21, 'katsu', '등심 돈까스', 7000, '돈까스', 0, 8, 900, 34, 0, 1, 0),
    (22, 'katsu', '치즈 돈까스', 7500, '돈까스', 0, 9, 1020, 40, 0, 1, 0),
    (23, 'katsu', '고구마치즈 돈까스', 7500, '돈까스', 0, 9, 1050, 36, 0, 1, 0),
    (24, 'katsu', '왕돈까스', 8000, '돈까스', 0, 9, 1100, 42, 0, 1, 0),
    (25, 'katsu', '돈까스 카레', 7000, '돈까스', 0, 8, 1000, 33, 0, 1, 0),
    (26, 'katsu', '가츠동', 6500, '돈까스', 0, 7, 880, 32, 0, 1, 0),
    (27, 'katsu', '치킨까스', 6500, '돈까스', 0, 8, 870, 36, 0, 1, 0),
    (28, 'katsu', '생선까스', 6500, '돈까스', 0, 7, 760, 28, 0, 0, 0),
    (29, 'snack', '치즈라면', 4500, '분식', 0, 4, 620, 20, 1, 0, 1),
    (30, 'snack', '떡볶이', 4000, '분식', 0, 5, 520, 10, 1, 0, 0),
    (31, 'snack', '라볶이', 5000, '분식', 0, 5, 650, 14, 1, 0, 0),
    (32, 'snack', '김밥', 3500, '분식', 0, 2, 480, 13, 0, 1, 0),
    (33, 'snack', '참치김밥', 4000, '분식', 0, 2, 540, 18, 0, 0, 0),
    (34, 'snack', '모둠튀김', 4000, '분식', 0, 4, 560, 9, 0, 0, 0),
    (35, 'snack', '순대', 4000, '분식', 0, 3, 500, 18, 0, 1, 0),
    (36, 'snack', '오므라이스', 5500, '분식', 0, 5, 720, 21, 0, 1, 0),
    (37, 'soup', '돼지국밥', 6500, '국물', 0, 4, 680, 35, 0, 1, 1),
    (38, 'soup', '순대국밥', 6500, '국물', 0, 4, 700, 32, 0, 1, 1),
    (39, 'soup', '김치찌개', 6000, '국물', 0, 6, 560, 26, 1, 1, 1),
    (40, 'soup', '된장찌개', 5500, '국물', 0, 6, 450, 20, 0, 0, 1),
    (41, 'soup', '부대찌개', 6500, '국물', 0, 7, 720, 30, 1, 1, 1),
    (42, 'soup', '순두부찌개', 6000, '국물', 0, 6, 480, 22, 1, 0, 1),
    (43, 'soup', '육개장', 6500, '국물', 0, 6, 520, 30, 1, 1, 1),
    (44, 'soup', '갈비탕', 8000, '국물', 0, 5, 640, 38, 0, 1, 1),
    (45, 'soup', '소고기미역국', 5500, '국물', 0, 4, 420, 24, 0, 1, 1);

-- ---------------------------------------------------------------------
-- 3. orders : 주문 내역
--    한 번의 결제(order_number)에 여러 메뉴가 담기면 메뉴별로 1행씩 저장
--    order_status : WAITING(접수) → COOKING(조리 중) → READY(준비 완료) → PICKED_UP(수령 완료) / CANCELED(취소)
-- ---------------------------------------------------------------------
CREATE TABLE orders (
    order_id     BIGINT       NOT NULL AUTO_INCREMENT COMMENT '주문 행 ID',
    order_number INT          NOT NULL                COMMENT '고객 호출용 주문번호(#101 등)',
    menu_name    VARCHAR(50)  NOT NULL                COMMENT '메뉴명',
    quantity     INT          NOT NULL DEFAULT 1      COMMENT '수량',
    total_price  INT          NOT NULL                COMMENT '해당 행 금액(단가 x 수량)',
    order_status ENUM('WAITING', 'COOKING', 'READY', 'PICKED_UP', 'CANCELED')
                              NOT NULL DEFAULT 'WAITING' COMMENT '주문 상태',
    order_time   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '주문 시각',
    PRIMARY KEY (order_id),
    KEY idx_orders_number      (order_number),
    KEY idx_orders_status_time (order_status, order_time),
    KEY idx_orders_time        (order_time),
    CONSTRAINT fk_orders_menu_name FOREIGN KEY (menu_name)
        REFERENCES menus (name) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_orders_quantity CHECK (quantity >= 1),
    CONSTRAINT chk_orders_price    CHECK (total_price >= 0)
) ENGINE = InnoDB COMMENT = '주문 내역';

-- ---------------------------------------------------------------------
-- 4. congestion : AI 15분 혼잡도 예측 결과 (predict.py가 갱신)
-- ---------------------------------------------------------------------
CREATE TABLE congestion (
    id               INT      NOT NULL AUTO_INCREMENT COMMENT '예측 레코드 ID',
    predicted_level  ENUM('원활', '보통', '혼잡') NOT NULL COMMENT '15분 뒤 예측 혼잡도',
    wait_minutes     INT      NOT NULL                COMMENT '예상 대기시간(분)',
    recommended_time TIME     NOT NULL                COMMENT '분산 방문 권장 시각',
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP COMMENT '갱신 시각',
    PRIMARY KEY (id),
    KEY idx_congestion_updated (updated_at),
    CONSTRAINT chk_congestion_wait CHECK (wait_minutes >= 0)
) ENGINE = InnoDB COMMENT = 'AI 혼잡도 예측';

-- 키오스크 상단 배너 초기값 ("현재 대기: 보통 / 12분 소요 / 12:35 분산 권장")
INSERT INTO congestion (predicted_level, wait_minutes, recommended_time)
VALUES ('보통', 12, '12:35:00');

-- ---------------------------------------------------------------------
-- 5. POS 상단 현황판용 오늘 주문 요약 뷰
-- ---------------------------------------------------------------------
CREATE VIEW v_today_order_summary AS
SELECT
    COUNT(DISTINCT CASE WHEN order_status = 'WAITING'   THEN order_number END) AS waiting_count,
    COUNT(DISTINCT CASE WHEN order_status = 'COOKING'   THEN order_number END) AS cooking_count,
    COUNT(DISTINCT CASE WHEN order_status = 'READY'     THEN order_number END) AS ready_count,
    COUNT(DISTINCT CASE WHEN order_status <> 'CANCELED' THEN order_number END) AS today_total_orders,
    COALESCE(SUM(CASE WHEN order_status <> 'CANCELED' THEN total_price END), 0) AS today_revenue
FROM orders
WHERE order_time >= CURDATE()
  AND order_time <  CURDATE() + INTERVAL 1 DAY;

-- ---------------------------------------------------------------------
-- 6. 확인용 조회
-- ---------------------------------------------------------------------
SELECT r.name AS restaurant, COUNT(*) AS menus FROM menus m JOIN restaurants r USING (restaurant_id) GROUP BY r.name;
SELECT category, COUNT(*) AS menus FROM menus GROUP BY category;
SELECT * FROM congestion ORDER BY updated_at DESC LIMIT 1;
SELECT * FROM v_today_order_summary;
