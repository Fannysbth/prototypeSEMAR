"""Model dari data Kaggle: Isolation Forest per klaim (tanpa label) dan supervised per penyedia (risiko faskes).

Evaluasi dengan GroupKFold per penyedia: penyedia uji tidak pernah terlihat saat latih (satu baris = satu penyedia).
sup_score untuk penyedia yang dikenal = skor out-of-fold, bukan skor model akhir pada data latihnya sendiri.
"""
import json
import math
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import GroupKFold

from features import CLAIM_FEATURES, FASKES_FEATURES, NEUTRAL, SKIPPED_FEATURES, claim_features, faskes_features

TOP_K_FRACTION = 0.05


def _rf():
    return RandomForestClassifier(n_estimators=300, min_samples_leaf=3, class_weight="balanced_subsample", random_state=42, n_jobs=-1)


def merge_labels(truth: pd.DataFrame, feedback: list[dict]) -> pd.Series:
    """Label Kaggle (per penyedia) digabung dengan keputusan verifikator; umpan balik menimpa."""
    labels = truth.drop_duplicates("faskes_id").set_index("faskes_id")["label"].astype(int)
    for fb in feedback:
        labels.loc[fb["faskes_id"]] = int(fb["label"])
    return labels


def evaluate_oof(X: pd.DataFrame, y: pd.Series, folds: int = 5):
    k_folds = max(2, min(folds, int(y.sum()), int((1 - y).sum())))
    oof = pd.Series(0.0, index=X.index)
    for tr, te in GroupKFold(n_splits=k_folds).split(X, y, groups=X.index):
        oof.iloc[te] = _rf().fit(X.iloc[tr], y.iloc[tr]).predict_proba(X.iloc[te])[:, 1]
    k = max(1, math.ceil(TOP_K_FRACTION * len(y)))
    top = y.loc[oof.sort_values(ascending=False).index[:k]]
    return oof, {
        "metode": f"GroupKFold {k_folds} lipatan per penyedia (penyedia uji tidak terlihat saat latih)",
        "pr_auc": round(float(average_precision_score(y, oof)), 4), "roc_auc": round(float(roc_auc_score(y, oof)), 4),
        "k_penyedia": k, "precision_at_k": round(float(top.mean()), 4), "recall_at_k": round(float(top.sum() / y.sum()), 4),
        "prevalensi_label": round(float(y.mean()), 4),
    }


def train(claims: pd.DataFrame, truth: pd.DataFrame, feedback: list[dict], model_dir: Path, report_path: Path | None = None) -> dict:
    cf = claim_features(claims)
    ff = faskes_features(claims, cf)
    labels = merge_labels(truth, feedback)
    X = ff.loc[ff.index.intersection(labels.index)]
    y = labels.loc[X.index]
    if y.nunique() < 2 or y.sum() < 2:
        raise ValueError("Label kurang: perlu minimal 2 penyedia fraud dan 1 non-fraud")

    oof, metrics = evaluate_oof(X, y)
    rf = _rf().fit(X, y)
    xc = cf[CLAIM_FEATURES].to_numpy()
    iforest = IsolationForest(n_estimators=200, random_state=42).fit(xc)
    raw = -iforest.score_samples(xc)
    lo, hi = float(raw.min()), float(raw.max())
    med, sd = X.median(), X.std().replace(0, 1.0).fillna(1.0)
    table = {}
    for fid in ff.index:
        z = ((ff.loc[fid] - med) / sd).clip(lower=0).fillna(0)
        contrib = rf.feature_importances_ * z.to_numpy()
        top = [[f"faskes:{FASKES_FEATURES[i]}", round(float(contrib[i]), 3)] for i in np.argsort(-contrib)[:3] if contrib[i] > 0]
        score = float(oof[fid]) if fid in oof.index else float(rf.predict_proba(ff.loc[[fid]])[0, 1])
        table[fid] = {"sup_score": round(score, 4), "labeled": fid in oof.index, "top_features": top}

    version = "kaggle-" + datetime.now().strftime("%Y%m%dT%H%M%S")
    metrics.update({
        "n_penyedia_berlabel": int(len(y)), "n_klaim": int(len(cf)), "n_umpan_balik": len(feedback),
        "fitur_klaim": CLAIM_FEATURES, "fitur_dilewati": SKIPPED_FEATURES,
        "catatan": "Label per penyedia (bukan per klaim); ICD-9; USD tahun 2009. Isolation Forest tanpa label dilatih pada semua klaim.",
    })
    artifact = {
        "version": version, "iforest": iforest, "if_range": (lo, hi), "rf": rf, "faskes": table, "metrics": metrics,
        "claim_features": CLAIM_FEATURES, "neutral": NEUTRAL, "trained_at": datetime.now().isoformat(timespec="seconds"),
    }
    model_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, model_dir / f"{version}.joblib")
    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps({"versi": version, **metrics}, indent=2, ensure_ascii=False), encoding="utf-8")
    return artifact


def load_latest(model_dir: Path):
    files = sorted(model_dir.glob("kaggle-*.joblib")) if model_dir.exists() else []
    return joblib.load(files[-1]) if files else None


def score(art: dict, faskes_id: str, features: dict) -> dict | None:
    """None bila penyedia tidak dikenal model (pemanggil memakai jalur lain)."""
    row = art["faskes"].get(faskes_id)
    if row is None:
        return None
    x = np.array([[float(features.get(f, art["neutral"][f])) for f in art["claim_features"]]])
    lo, hi = art["if_range"]
    if_score = float(np.clip((-art["iforest"].score_samples(x)[0] - lo) / (hi - lo + 1e-9), 0, 1))
    return {"if_score": round(if_score, 4), "sup_score": row["sup_score"], "model_version": art["version"], "top_features": row["top_features"],
            "faskes_dikenal": True, "fitur_tidak_dikirim": [f for f in art["claim_features"] if f not in features]}
