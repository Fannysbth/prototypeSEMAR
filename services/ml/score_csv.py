"""Skor offline untuk evaluasi: python score_csv.py masuk.csv keluar.csv HARI_LATIH
masuk.csv: claim_ref,day,label,holdout,<fitur...>. Model dilatih hanya dari baris day < HARI_LATIH (split waktu)."""
import sys
from pathlib import Path

import numpy as np

from models import META_COLS, fit, load_rows, score

src, dst, train_days = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
head, rows = load_rows(src)
features = [c for c in head if c not in META_COLS]
X = np.array([[float(r[f]) for f in features] for r in rows])
y = np.array([int(r["label"]) for r in rows])
hold = np.array([int(r["holdout"]) for r in rows])
is_train = np.array([int(r["day"]) < train_days for r in rows])
iforest, sup, _ = fit(X, y, hold, is_train)
if_s, sup_s = score(iforest, sup, X)
dst.write_text("claim_ref,if_score,sup_score\n" + "\n".join(f"{r['claim_ref']},{a:.5f},{b:.5f}" for r, a, b in zip(rows, if_s, sup_s)) + "\n", encoding="utf-8")
