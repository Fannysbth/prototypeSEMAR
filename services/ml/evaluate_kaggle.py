"""Evaluasi model Kaggle per penyedia: model lengkap, ablasi, dan ekspor skor untuk eval-kit.

Penyedia uji tidak pernah terlihat saat latih (satu baris = satu penyedia; lipatan acak per penyedia, diulang 5 kali).
Skor yang diekspor adalah rata-rata skor out-of-fold, bukan skor model akhir pada data latihnya sendiri.
Pemakaian: python evaluate_kaggle.py <claims_tokenized.csv> <truth_provider.csv> <groups.csv> <out_dir>
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold

from features import claim_features, faskes_features
from kaggle_model import TOP_K_FRACTION, _rf

REPEATS = 5
CROSS = ["share_multi_faskes_patients", "mean_n_faskes_30d", "mean_n_kunjungan_30d", "mean_overlap_inap_hari", "mean_same_diag_multi_faskes_14d"]


def oof_scores(X: pd.DataFrame, y: pd.Series, seed: int) -> pd.Series:
    oof = pd.Series(0.0, index=X.index)
    for tr, te in StratifiedKFold(n_splits=5, shuffle=True, random_state=seed).split(X, y):
        oof.iloc[te] = _rf().fit(X.iloc[tr], y.iloc[tr]).predict_proba(X.iloc[te])[:, 1]
    return oof


def metrics(y: pd.Series, s: pd.Series) -> dict:
    k = max(1, math.ceil(TOP_K_FRACTION * len(y)))
    top = y.loc[s.sort_values(ascending=False).index[:k]]
    return {"pr_auc": average_precision_score(y, s), "roc_auc": roc_auc_score(y, s), "precision_at_k": top.mean(), "recall_at_k": top.sum() / y.sum()}


def summarize(runs: list[dict]) -> dict:
    return {m: {"mean": round(float(np.mean([r[m] for r in runs])), 4), "sd": round(float(np.std([r[m] for r in runs])), 4)} for m in runs[0]}


def rule_baseline(ff: pd.DataFrame) -> pd.Series:
    """Aturan sederhana tanpa pembelajaran: peringkat gabungan rata-rata tagihan dan rata-rata lama rawat."""
    return ff["billed_mean"].rank(pct=True) + ff["los_mean"].rank(pct=True)


def main(claims_csv, truth_csv, groups_csv, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    claims = pd.read_csv(claims_csv, dtype=str)
    truth = pd.read_csv(truth_csv).drop_duplicates("faskes_id").set_index("faskes_id")["label"].astype(int)
    ff = faskes_features(claims, claim_features(claims))
    X = ff.loc[ff.index.intersection(truth.index)]
    y = truth.loc[X.index]

    variants = {"full": X, "no_cross": X.drop(columns=CROSS)}
    result = {"k_persen": TOP_K_FRACTION * 100, "ulangan": REPEATS, "n_penyedia": int(len(y)), "n_fraud": int(y.sum()), "prevalensi": round(float(y.mean()), 4), "varian": {}}
    full_scores = []
    for name, Xv in variants.items():
        runs = []
        for seed in range(REPEATS):
            s = oof_scores(Xv, y, seed)
            runs.append(metrics(y, s))
            if name == "full":
                full_scores.append(s)
        result["varian"][name] = summarize(runs)
    result["varian"]["no_ml"] = summarize([metrics(y, rule_baseline(X))])
    result["varian"]["no_rules"] = None  # tidak berlaku: detektor aturan bekerja per klaim lintas faskes, bukan per penyedia
    result["acak"] = {"pr_auc": round(float(y.mean()), 4), "roc_auc": 0.5}

    groups = pd.read_csv(groups_csv).set_index("faskes_id")
    score = pd.concat(full_scores, axis=1).mean(axis=1)
    pd.DataFrame({
        "entity_id": X.index, "group_id": groups["group_id"].reindex(X.index).fillna("tidak diketahui").to_numpy(),
        "score": score.round(6).to_numpy(), "stratum": groups["stratum"].reindex(X.index).fillna("RJ-dominan").to_numpy(),
    }).to_csv(out / "scores.csv", index=False)
    pd.DataFrame({"entity_id": X.index, "label": y.to_numpy(), "modus": "", "excess_rupiah": 0}).to_csv(out / "truth.csv", index=False)
    (out / "ablation.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result["varian"]["full"]))


if __name__ == "__main__":
    main(*sys.argv[1:5])
