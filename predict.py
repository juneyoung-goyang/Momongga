# -*- coding: utf-8 -*-
"""
학생식당 스마트오더 - 15분 뒤 혼잡도 예측 (RandomForestClassifier)

실행 방법
    pip install scikit-learn pandas numpy
    python predict.py            # 박스 문자(╔═╗)로 출력
    python predict.py --ascii    # 박스 문자가 깨지는 터미널용 (+-| 로 출력)
    python predict.py --data 주문기록.csv   # 직원 POS '학습 데이터 내보내기' 파일을 더해 재학습
    (실행할 때마다 shared/forecast.js 에 시간대별 예측을 저장 → 학생 앱·POS·관리자가 이 값을 씀)

동작 순서
    1. 점심시간(11:00~14:00) 가상 주문 데이터 500건을 내부에서 생성
       (피크 11:30~13:30, 요일, 직전 15분 주문건수, 시험기간 여부)
    2. RandomForestClassifier로 15분 뒤 혼잡도(원활/보통/혼잡) 학습
       RandomForestRegressor로 예상 대기시간(분) 학습
    3. 현재 시각 12:15, 직전 15분 주문 38건 기준으로 추론
    4. 결과를 콘솔 박스로 출력하고 congestion 테이블 갱신용 SQL을 함께 출력
"""

import json
import os
import sys
import unicodedata
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.metrics import accuracy_score, classification_report, mean_absolute_error
from sklearn.model_selection import train_test_split

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# ---------------------------------------------------------------------
# 설정값
# ---------------------------------------------------------------------
RANDOM_SEED = 42
N_SAMPLES = 500

LUNCH_START = 11 * 60          # 11:00
LUNCH_END = 14 * 60            # 14:00
PEAK_START = 11 * 60 + 30      # 11:30
PEAK_END = 13 * 60 + 30        # 13:30
PEAK_CENTER = 12 * 60 + 15     # 수요가 가장 몰리는 시각 12:15

LEVELS = ["원활", "보통", "혼잡"]
LEVEL_THRESHOLDS = (24, 48)    # 15분 뒤 주문건수 기준: 24건 미만 원활, 48건 미만 보통, 그 이상 혼잡
WEEKDAY_NAMES = ["월", "화", "수", "목", "금", "토", "일"]
WEEKDAY_FACTOR = {0: 1.05, 1: 1.00, 2: 1.10, 3: 1.00, 4: 0.80, 5: 0.40, 6: 0.30}
WEEKDAY_PROB = [0.18, 0.18, 0.18, 0.18, 0.16, 0.06, 0.06]
EXAM_FACTOR = 0.85             # 시험기간: 수업이 줄어 점심 방문이 흩어져 피크 대기 감소 (멘토링 피드백 반영)
EXAM_PROB = 0.20
EVENT_FACTOR = 1.30            # 교내 행사: 외부 방문객 증가
EVENT_PROB = 0.10
RAIN_FACTOR = 1.15             # 비: 교외 식사 감소로 학식 수요 증가
RAIN_PROB = 0.25

# 시연 시나리오 (현재 시각 12:15, 직전 15분 주문 38건)
CURRENT_TIME = "12:15"
CURRENT_PREV_ORDERS = 38
CURRENT_WEEKDAY = 2            # 0=월 ... 6=일 (시연 기준 수요일)
CURRENT_IS_EXAM = 0            # 1이면 시험기간
CURRENT_IS_EVENT = 0           # 1이면 교내 행사
CURRENT_IS_RAIN = 0            # 1이면 비

FEATURES = ["minute_of_day", "weekday", "prev_15min_orders", "is_exam_period", "is_event", "is_rain", "is_peak"]
FEATURE_LABELS = {
    "minute_of_day": "시각(분)",
    "weekday": "요일",
    "prev_15min_orders": "직전 15분 주문건수",
    "is_exam_period": "시험기간 여부",
    "is_event": "교내 행사 여부",
    "is_rain": "비 여부",
    "is_peak": "피크타임 여부",
}

USE_ASCII = "--ascii" in sys.argv
BOX_WIDTH = 64


# ---------------------------------------------------------------------
# 1. 가상 데이터 생성
# ---------------------------------------------------------------------
def demand_curve(minute):
    """시각(분)별 기본 주문 수요. 12:15를 중심으로 11:30~13:30에 몰리는 종 모양 곡선."""
    minute = np.asarray(minute, dtype=float)
    return 6.0 + 40.0 * np.exp(-((minute - PEAK_CENTER) / 48.0) ** 2)


def is_peak(minute):
    minute = np.asarray(minute)
    return ((minute >= PEAK_START) & (minute <= PEAK_END)).astype(int)


def orders_to_level(orders):
    low, high = LEVEL_THRESHOLDS
    return np.select([orders < low, orders < high], [0, 1], default=2)


def generate_dataset(n_samples, rng):
    minute = rng.choice(np.arange(LUNCH_START, LUNCH_END + 1, 5), size=n_samples)
    weekday = rng.choice(7, size=n_samples, p=WEEKDAY_PROB)
    is_exam = (rng.random(n_samples) < EXAM_PROB).astype(int)
    is_event = (rng.random(n_samples) < EVENT_PROB).astype(int)
    is_rain = (rng.random(n_samples) < RAIN_PROB).astype(int)

    factor = (np.vectorize(WEEKDAY_FACTOR.get)(weekday)
              * np.where(is_exam == 1, EXAM_FACTOR, 1.0)
              * np.where(is_event == 1, EVENT_FACTOR, 1.0)
              * np.where(is_rain == 1, RAIN_FACTOR, 1.0))

    expected_prev = demand_curve(minute - 15) * factor
    prev_orders = np.clip(rng.normal(expected_prev, 3.0 + 0.10 * expected_prev), 0, None).round()

    expected_next = demand_curve(minute) * factor
    next_orders = expected_next + 0.45 * (prev_orders - expected_prev) + rng.normal(0, 3.0, n_samples)
    next_orders = np.clip(next_orders, 0, None).round()

    wait_minutes = np.clip(2.0 + 0.22 * next_orders + rng.normal(0, 1.0, n_samples), 1, None).round()

    return pd.DataFrame({
        "minute_of_day": minute,
        "weekday": weekday,
        "prev_15min_orders": prev_orders.astype(int),
        "is_exam_period": is_exam,
        "is_event": is_event,
        "is_rain": is_rain,
        "is_peak": is_peak(minute),
        "next_15min_orders": next_orders.astype(int),
        "wait_minutes": wait_minutes.astype(int),
        "congestion_level": orders_to_level(next_orders),
    })


# ---------------------------------------------------------------------
# 2. 학습
# ---------------------------------------------------------------------
def train_models(df):
    X = df[FEATURES]
    y_level = df["congestion_level"]
    y_wait = df["wait_minutes"]

    X_train, X_test, yl_train, yl_test, yw_train, yw_test = train_test_split(
        X, y_level, y_wait, test_size=0.2, random_state=RANDOM_SEED, stratify=y_level
    )

    clf = RandomForestClassifier(
        n_estimators=200, max_depth=8, min_samples_leaf=3,
        class_weight="balanced", random_state=RANDOM_SEED, n_jobs=-1
    )
    clf.fit(X_train, yl_train)

    reg = RandomForestRegressor(
        n_estimators=200, max_depth=8, min_samples_leaf=3,
        random_state=RANDOM_SEED, n_jobs=-1
    )
    reg.fit(X_train, yw_train)

    level_pred = clf.predict(X_test)
    # 비교 기준(단순 규칙): "다음 15분도 직전 15분과 같다"고 가정
    base_level = orders_to_level(X_test["prev_15min_orders"].to_numpy())
    base_wait = np.round(2.0 + 0.22 * X_test["prev_15min_orders"].to_numpy())
    metrics = {
        "accuracy": accuracy_score(yl_test, level_pred),
        "wait_mae": mean_absolute_error(yw_test, reg.predict(X_test)),
        "baseline_accuracy": accuracy_score(yl_test, base_level),
        "baseline_mae": mean_absolute_error(yw_test, base_wait),
        "report": classification_report(
            yl_test, level_pred, labels=[0, 1, 2], target_names=LEVELS, zero_division=0
        ),
        "train_size": len(X_train),
        "test_size": len(X_test),
    }
    return clf, reg, metrics


# ---------------------------------------------------------------------
# 2-1. 실제 주문 기록으로 학습 데이터 만들기 (직원 POS의 '학습 데이터 내보내기' CSV)
#      컬럼: order_minute(분), weekday, is_exam, is_event, is_rain, wait_minutes(실제 수령까지 걸린 분, 없으면 빈칸)
# ---------------------------------------------------------------------
def load_real_orders(path):
    raw = pd.read_csv(path, encoding='utf-8-sig')
    raw = raw.sort_values("order_minute").reset_index(drop=True)
    rows = []
    minutes = raw["order_minute"].to_numpy()
    for _, r in raw.iterrows():
        m = int(r["order_minute"])
        prev = int(((minutes >= m - 15) & (minutes < m)).sum())
        nxt = int(((minutes >= m) & (minutes < m + 15)).sum())
        wait = r.get("wait_minutes")
        if pd.isna(wait):
            continue
        rows.append({
            "minute_of_day": m, "weekday": int(r["weekday"]), "prev_15min_orders": prev,
            "is_exam_period": int(r.get("is_exam", 0)), "is_event": int(r.get("is_event", 0)), "is_rain": int(r.get("is_rain", 0)),
            "is_peak": int(PEAK_START <= m <= PEAK_END), "next_15min_orders": nxt,
            "wait_minutes": int(round(float(wait))), "congestion_level": int(orders_to_level(np.array([nxt]))[0]),
        })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------
# 2-2. 시간대별 예측을 shared/forecast.js 로 내보내기 (앱이 읽는 실제 모델 출력)
# ---------------------------------------------------------------------
def export_forecast(clf, reg, metrics, df, n_real, path):
    weekday = CURRENT_WEEKDAY
    timelines = {}
    for exam in (0, 1):
        for event in (0, 1):
            for rain in (0, 1):
                factor = (WEEKDAY_FACTOR[weekday] * (EXAM_FACTOR if exam else 1.0)
                          * (EVENT_FACTOR if event else 1.0) * (RAIN_FACTOR if rain else 1.0))
                rows = []
                for minute in range(11 * 60 + 30, LUNCH_END, 10):
                    prev = int(round(float(demand_curve(minute - 15)) * factor))
                    rows.append({"minute_of_day": minute, "weekday": weekday, "prev_15min_orders": prev,
                                 "is_exam_period": exam, "is_event": event, "is_rain": rain,
                                 "is_peak": int(PEAK_START <= minute <= PEAK_END)})
                X = pd.DataFrame(rows)[FEATURES]
                waits = reg.predict(X)
                levels = clf.predict(X)
                timelines[f"{exam}{event}{rain}"] = [
                    {"t": to_hhmm(r["minute_of_day"]), "w": max(2, int(round(float(w)))), "level": LEVELS[int(lv)]}
                    for r, w, lv in zip(rows, waits, levels)
                ]
    importance = sorted(zip(FEATURES, clf.feature_importances_), key=lambda x: x[1], reverse=True)
    data = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "model": "RandomForestClassifier(혼잡도) + RandomForestRegressor(대기시간)",
        "samples": int(len(df)), "real_orders": int(n_real),
        "weekday": weekday, "weekday_name": WEEKDAY_NAMES[weekday],
        "metrics": {k: round(float(metrics[k]), 4) for k in ("accuracy", "wait_mae", "baseline_accuracy", "baseline_mae")},
        "importance": [{"key": k, "label": FEATURE_LABELS[k], "score": round(float(v), 4)} for k, v in importance],
        "features": [{"key": k, "label": FEATURE_LABELS[k]} for k in FEATURES],
        "targets": ["15분 뒤 혼잡도(원활/보통/혼잡)", "15분 뒤 예상 대기시간(분)"],
        "timelines": timelines,
    }
    with open(path, "w", encoding="utf-8") as f:
        f.write("/* predict.py가 자동으로 만든 파일입니다. 직접 고치지 말고 python predict.py 로 다시 만드세요. */\n")
        f.write("window.MJC_FORECAST = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n")
    return data


# ---------------------------------------------------------------------
# 3. 추론
# ---------------------------------------------------------------------
def to_minute(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def to_hhmm(minute):
    return "{:02d}:{:02d}".format(int(minute) // 60, int(minute) % 60)


def make_row(minute, weekday, prev_orders, is_exam):
    return pd.DataFrame([{
        "minute_of_day": minute,
        "weekday": weekday,
        "prev_15min_orders": prev_orders,
        "is_exam_period": is_exam,
        "is_event": CURRENT_IS_EVENT,
        "is_rain": CURRENT_IS_RAIN,
        "is_peak": int(PEAK_START <= minute <= PEAK_END),
    }])[FEATURES]


def predict_slot(clf, reg, minute, weekday, prev_orders, is_exam):
    row = make_row(minute, weekday, prev_orders, is_exam)
    proba = np.zeros(len(LEVELS))
    proba[clf.classes_] = clf.predict_proba(row)[0]
    level_idx = int(np.argmax(proba))
    wait = max(1, int(round(float(reg.predict(row)[0]))))
    return level_idx, wait, proba


def expected_prev_orders(minute, weekday, is_exam):
    factor = (WEEKDAY_FACTOR[weekday] * (EXAM_FACTOR if is_exam else 1.0)
              * (EVENT_FACTOR if CURRENT_IS_EVENT else 1.0) * (RAIN_FACTOR if CURRENT_IS_RAIN else 1.0))
    return float(demand_curve(minute - 15)) * factor


def projected_prev_orders(minute, now_minute, current_prev, weekday, is_exam):
    """미래 시각의 직전 15분 주문건수 추정.
    평균 수요 곡선에 '지금 실제 주문이 평균보다 많은/적은 정도'를 15분마다 40%씩 줄여서 더함."""
    deviation = current_prev - expected_prev_orders(now_minute, weekday, is_exam)
    steps = (minute - now_minute) / 15.0
    value = expected_prev_orders(minute, weekday, is_exam) + deviation * (0.6 ** steps)
    return max(0, int(round(value)))


def find_recommended_time(clf, reg, now_minute, current_prev, current_wait, weekday, is_exam):
    """예상 대기시간이 지금보다 30% 이상 줄어드는 가장 이른 시각을 분산 방문 권장 시각으로 선택."""
    target_wait = current_wait * 0.7
    best = None
    for minute in range(now_minute + 20, LUNCH_END, 5):
        prev = projected_prev_orders(minute, now_minute, current_prev, weekday, is_exam)
        level_idx, wait, _ = predict_slot(clf, reg, minute, weekday, prev, is_exam)
        if best is None or wait < best[1]:
            best = (minute, wait, level_idx)
        if wait <= target_wait:
            return minute, wait, level_idx
    return best


def forecast_timeline(clf, reg, start_minute, weekday, is_exam, current_prev):
    rows = []
    for minute in range(start_minute, LUNCH_END - 14, 15):
        prev = projected_prev_orders(minute, start_minute, current_prev, weekday, is_exam)
        level_idx, wait, _ = predict_slot(clf, reg, minute, weekday, prev, is_exam)
        rows.append((to_hhmm(minute + 15), LEVELS[level_idx], wait))
    return rows


# ---------------------------------------------------------------------
# 4. 콘솔 박스 출력 (한글 2칸 폭 보정)
# ---------------------------------------------------------------------
def display_width(text):
    width = 0
    for ch in text:
        width += 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
    return width


def pad(text, width):
    return text + " " * max(0, width - display_width(text))


BOX = {
    "tl": "+", "tr": "+", "bl": "+", "br": "+", "h": "-", "v": "|", "ml": "+", "mr": "+", "sh": "-",
} if USE_ASCII else {
    "tl": "╔", "tr": "╗", "bl": "╚", "br": "╝", "h": "═", "v": "║", "ml": "╟", "mr": "╢", "sh": "─",
}


def box_top():
    return BOX["tl"] + BOX["h"] * (BOX_WIDTH - 2) + BOX["tr"]


def box_bottom():
    return BOX["bl"] + BOX["h"] * (BOX_WIDTH - 2) + BOX["br"]


def box_divider():
    return BOX["ml"] + BOX["sh"] * (BOX_WIDTH - 2) + BOX["mr"]


def box_line(text=""):
    return BOX["v"] + " " + pad(text, BOX_WIDTH - 4) + " " + BOX["v"]


def box_kv(key, value):
    return box_line(pad(key, 21) + value)


def level_bar(proba):
    return " | ".join("{} {:>3.0f}%".format(name, p * 100) for name, p in zip(LEVELS, proba))


def meter(level_idx):
    filled = (level_idx + 1) * 6
    return "[" + "=" * filled + " " * (18 - filled) + "]"


def print_box(lines):
    print(box_top())
    for line in lines:
        if line == "---":
            print(box_divider())
        else:
            print(box_line(line) if not isinstance(line, tuple) else box_kv(*line))
    print(box_bottom())


# ---------------------------------------------------------------------
# main
# ---------------------------------------------------------------------
def main():
    rng = np.random.default_rng(RANDOM_SEED)

    print()
    print("[1/3] 점심시간 가상 주문 데이터 {}건 생성 중".format(N_SAMPLES))
    df = generate_dataset(N_SAMPLES, rng)
    n_real = 0
    if "--data" in sys.argv:
        path = sys.argv[sys.argv.index("--data") + 1]
        real = load_real_orders(path)
        n_real = len(real)
        df = pd.concat([df, real], ignore_index=True)
        print("      실제 주문 기록 {}건을 학습 데이터에 더했어요 ({})".format(n_real, path))
    dist = df["congestion_level"].value_counts().reindex([0, 1, 2], fill_value=0)
    print("      혼잡도 분포  원활 {}건, 보통 {}건, 혼잡 {}건".format(dist[0], dist[1], dist[2]))
    print("      피크타임(11:30~13:30) 샘플 {}건, 시험기간 샘플 {}건".format(
        int(df["is_peak"].sum()), int(df["is_exam_period"].sum())))
    print()
    print(df.head(5).to_string(index=False))
    print()

    print("[2/3] RandomForestClassifier / RandomForestRegressor 학습 중")
    clf, reg, metrics = train_models(df)
    print("      학습 {}건, 검증 {}건".format(metrics["train_size"], metrics["test_size"]))
    print("      혼잡도 분류 정확도 {:.1f}%, 대기시간 평균 오차 {:.2f}분".format(
        metrics["accuracy"] * 100, metrics["wait_mae"]))
    print("      비교: 단순 규칙(직전 15분이 그대로 간다고 가정) 정확도 {:.1f}%, 평균 오차 {:.2f}분".format(
        metrics["baseline_accuracy"] * 100, metrics["baseline_mae"]))
    print()
    print(metrics["report"])

    print("[3/3] 현재 시각 기준 15분 뒤 혼잡도 추론")
    print()

    now_minute = to_minute(CURRENT_TIME)
    level_idx, wait, proba = predict_slot(
        clf, reg, now_minute, CURRENT_WEEKDAY, CURRENT_PREV_ORDERS, CURRENT_IS_EXAM
    )
    rec_minute, rec_wait, rec_level = find_recommended_time(
        clf, reg, now_minute, CURRENT_PREV_ORDERS, wait, CURRENT_WEEKDAY, CURRENT_IS_EXAM
    )
    timeline = forecast_timeline(clf, reg, now_minute, CURRENT_WEEKDAY, CURRENT_IS_EXAM, CURRENT_PREV_ORDERS)

    importance = sorted(zip(FEATURES, clf.feature_importances_), key=lambda x: x[1], reverse=True)
    today = datetime.now().strftime("%Y-%m-%d")

    lines = [
        "학생식당 AI 15분 혼잡도 예측 리포트",
        "---",
        ("기준 시각", "{} ({}요일) {}".format(today, WEEKDAY_NAMES[CURRENT_WEEKDAY], CURRENT_TIME)),
        ("직전 15분 주문", "{}건".format(CURRENT_PREV_ORDERS)),
        ("시험기간", "예" if CURRENT_IS_EXAM else "아니오"),
        ("교내 행사 / 비", ("있음" if CURRENT_IS_EVENT else "없음") + " / " + ("예" if CURRENT_IS_RAIN else "아니오")),
        ("피크타임", "예 (11:30~13:30)" if PEAK_START <= now_minute <= PEAK_END else "아니오"),
        "---",
        ("예측 대상", "{} (15분 뒤)".format(to_hhmm(now_minute + 15))),
        ("예측 혼잡도", "{}  {}".format(LEVELS[level_idx], meter(level_idx))),
        ("예상 대기시간", "약 {}분".format(wait)),
        ("분산 권장 시각", "{} (대기 약 {}분, {})".format(to_hhmm(rec_minute), rec_wait, LEVELS[rec_level])),
        ("클래스 확률", level_bar(proba)),
        "---",
        "향후 혼잡도 흐름",
    ]
    for slot, lvl, w in timeline:
        lines.append(("  " + slot, "{}  대기 약 {}분".format(lvl, w)))
    lines += [
        "---",
        ("분류 정확도", "{:.1f}% (검증 {}건)".format(metrics["accuracy"] * 100, metrics["test_size"])),
        ("대기시간 오차", "평균 {:.2f}분 (MAE)".format(metrics["wait_mae"])),
        "주요 판단 근거",
    ]
    for name, score in importance[:3]:
        lines.append(("  " + FEATURE_LABELS[name], "{:.1f}%".format(score * 100)))
    print_box(lines)

    banner = "현재 대기: {} / {}분 소요 / {} 분산 권장".format(LEVELS[level_idx], wait, to_hhmm(rec_minute))
    print()
    print("학생 앱 배너 문구")
    print("  " + banner)
    print()
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shared", "forecast.js")
    if "--no-export" not in sys.argv and os.path.isdir(os.path.dirname(out)):
        export_forecast(clf, reg, metrics, df, n_real, out)
        print("앱이 쓰는 시간대별 예측을 저장했어요: " + out)
        print()
    print("congestion 테이블 갱신 SQL")
    print("  INSERT INTO congestion (predicted_level, wait_minutes, recommended_time)")
    print("  VALUES ('{}', {}, '{}:00');".format(LEVELS[level_idx], wait, to_hhmm(rec_minute)))
    print()


if __name__ == "__main__":
    main()
