"""Layanan ML SAMAR (zona token): Isolation Forest + model supervised di atas fitur lintas-faskes ber-token.

Dilatih saat start dari data/train.csv (dibuat `npm run demo:reset` / scripts/build-training-set.js dari data sintetis).
Split berdasarkan waktu (minggu 1-8 latih, sisanya uji). Satu modus (hold-out) tidak dipakai melatih model supervised.
Jalankan: uvicorn app:app --port 4106
"""
import hashlib
import hmac
import os
from datetime import date, timedelta
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sklearn.ensemble import GradientBoostingClassifier, IsolationForest
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

TRAIN_CSV = Path(os.environ.get("ML_TRAIN_CSV", Path(__file__).parent / "data" / "train.csv"))
INTERNAL_KEY = os.environ.get("INTERNAL_API_KEY", "")
TRAIN_DAYS = 56
META_COLS = {"claim_ref", "admit_date", "label", "modus", "holdout"}

app = FastAPI(title="SAMAR ml", docs_url=None, redoc_url=None, openapi_url=None)
state: dict = {}


def load_rows(path: Path):
    lines = path.read_text(encoding="utf-8").strip().splitlines()
    head = lines[0].split(",")
    rows = [dict(zip(head, ln.split(","))) for ln in lines[1:]]
    return head, rows


def train() -> None:
    if not TRAIN_CSV.exists():
        return
    head, rows = load_rows(TRAIN_CSV)
    features = [c for c in head if c not in META_COLS]
    X = np.array([[float(r[f]) for f in features] for r in rows])
    y = np.array([int(r["label"]) for r in rows])
    hold = np.array([int(r["holdout"]) for r in rows])
    days = [date.fromisoformat(r["admit_date"]) for r in rows]
    cut = min(days) + timedelta(days=TRAIN_DAYS)
    is_train = np.array([d < cut for d in days])
    is_test = ~is_train

    iforest = IsolationForest(n_estimators=200, random_state=42).fit(X[is_train & (y == 0)])
    sup_mask = is_train & (hold == 0)
    sup = make_pipeline(StandardScaler(), GradientBoostingClassifier(random_state=42)).fit(X[sup_mask], y[sup_mask])
    normal = X[is_train & (y == 0)]

    metrics = {"n_train": int(sup_mask.sum()), "n_test": int(is_test.sum()), "train_cutoff": cut.isoformat(), "holdout_modus_excluded": True}
    if is_test.sum() and len(set(y[is_test])) == 2:
        s_sup = sup.predict_proba(X[is_test])[:, 1]
        s_if = -iforest.score_samples(X[is_test])
        yt = y[is_test]
        k = max(1, int(0.01 * len(yt)))
        top = np.argsort(-s_sup)[:k]
        metrics.update({
            "supervised_roc_auc": round(float(roc_auc_score(yt, s_sup)), 4),
            "supervised_pr_auc": round(float(average_precision_score(yt, s_sup)), 4),
            "isolation_forest_roc_auc": round(float(roc_auc_score(yt, s_if)), 4),
            "precision_at_1pct": round(float(yt[top].mean()), 4),
        })
        hm = is_test & (hold == 1)
        if hm.sum():
            metrics["recall_holdout_modus"] = round(float((sup.predict_proba(X[hm])[:, 1] >= 0.5).mean()), 4)
    digest = hashlib.sha1(TRAIN_CSV.read_bytes()).hexdigest()[:8]
    state.update(
        features=features, iforest=iforest, sup=sup, mean=normal.mean(axis=0), std=normal.std(axis=0) + 1e-9,
        importance=sup[-1].feature_importances_, version=f"sup-v1-{digest}", metrics=metrics,
    )


train()


@app.middleware("http")
async def internal_key(request: Request, call_next):
    if request.url.path != "/health" and INTERNAL_KEY and not hmac.compare_digest(request.headers.get("x-internal-key", ""), INTERNAL_KEY):
        return JSONResponse({"error": {"code": "UNAUTHENTICATED", "message": "Kunci antar-layanan tidak valid"}}, status_code=401)
    return await call_next(request)


class ScoreRequest(BaseModel):
    features: dict[str, float]


@app.get("/health")
def health():
    return {"ok": True, "service": "ml", "model_ready": "sup" in state}


@app.get("/model")
def model():
    if "sup" not in state:
        raise HTTPException(503, "Model belum dilatih. Jalankan npm run demo:reset")
    return {"version": state["version"], "features": state["features"], "metrics": state["metrics"], "algorithms": ["IsolationForest", "GradientBoostingClassifier+StandardScaler"]}


@app.post("/score")
def score(req: ScoreRequest):
    if "sup" not in state:
        raise HTTPException(503, "Model belum dilatih. Jalankan npm run demo:reset")
    missing = [f for f in state["features"] if f not in req.features]
    if missing:
        raise HTTPException(422, f"Fitur tidak lengkap: {', '.join(missing)}")
    x = np.array([[req.features[f] for f in state["features"]]])
    z = (x[0] - state["mean"]) / state["std"]
    contrib = state["importance"] * np.clip(z, 0, None)
    order = np.argsort(-contrib)[:3]
    return {
        "if_score": round(float(-state["iforest"].score_samples(x)[0]), 4),
        "sup_score": round(float(state["sup"].predict_proba(x)[0, 1]), 4),
        "model_version": state["version"],
        "top_features": [[state["features"][i], round(float(contrib[i]), 3)] for i in order if contrib[i] > 0],
    }
