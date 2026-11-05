-- =====================================================================
--  MJC Table 스마트오더 - Supabase 설정
--  Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run (여러 번 실행해도 안전)
-- =====================================================================

-- 1. 주문 테이블 (주문 1건 = 1행, 화면이 쓰는 주문 객체 전체를 data에 저장)
create table if not exists public.orders (
  order_number integer primary key,
  order_status text not null default 'WAITING',
  channel      text,
  total_price  integer not null default 0,
  data         jsonb not null,
  updated_at   timestamptz not null default now()
);

-- 2. 공유 상태 테이블 (품절 목록, 주문번호 시퀀스, 데모 시계)
create table if not exists public.app_state (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

-- 3. 접근 권한: 시연용으로 anon 키에 읽기/쓰기 허용
--    (anon 키는 브라우저에 노출되므로 실서비스 전에는 로그인 기반 정책으로 바꿔야 함)
alter table public.orders    enable row level security;
alter table public.app_state enable row level security;

drop policy if exists "demo full access orders" on public.orders;
create policy "demo full access orders" on public.orders
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "demo full access app_state" on public.app_state;
create policy "demo full access app_state" on public.app_state
  for all to anon, authenticated using (true) with check (true);

-- 4. Realtime: 테이블 변경을 브라우저로 실시간 전송
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.app_state;
exception when duplicate_object then null; end $$;

-- 5. 보고서/확인용 뷰: 오늘 매출 요약 (취소 제외)
create or replace view public.v_today_summary as
select
  count(*) filter (where order_status <> 'CANCELED')                         as total_orders,
  count(*) filter (where order_status <> 'CANCELED' and channel = '모바일')   as mobile_orders,
  count(*) filter (where order_status <> 'CANCELED' and channel <> '모바일')  as kiosk_orders,
  coalesce(sum(total_price) filter (where order_status <> 'CANCELED'), 0)    as revenue,
  count(*) filter (where order_status in ('WAITING', 'COOKING'))              as in_queue,
  count(*) filter (where order_status = 'READY')                             as ready_for_pickup
from public.orders;
