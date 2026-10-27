"""Pelatihan model SAMAR ml. Dipakai layanan (app.py) dan evaluator offline (score_csv.py) agar keduanya identik."""
from pathlib import Path

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier, IsolationForest
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

META_COLS = {"claim_ref", "admit_date", "day", "label", "modus", "holdout", "split"}


def load_rows(path: Path):
    lines = path.read_text(encoding="utf-8").strip().splitlines()
    head = lines[0].split(",")
    return head, [dict(zip(head, ln.split(","))) for ln in lines[1:]]


def fit(X, y, hold, is_train):
    """Isolation Forest dari klaim normal masa latih; supervised dari masa latih tanpa modus hold-out."""
    iforest = IsolationForest(n_estimators=200, random_state=42).fit(X[is_train & (y == 0)])
    sup_mask = is_train & (hold == 0)
    sup = make_pipeline(StandardScaler(), GradientBoostingClassifier(random_state=42)).fit(X[sup_mask], y[sup_mask])
    return iforest, sup, sup_mask


def score(iforest, sup, X):
    return -iforest.score_samples(X), sup.predict_proba(X)[:, 1]
