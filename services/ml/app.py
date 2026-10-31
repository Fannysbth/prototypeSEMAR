"""Layanan ML SAMAR (zona token): Isolation Forest + model supervised di atas fitur lintas-faskes ber-token.

Dilatih saat start dari data/train.csv (dibuat `npm run demo:reset` / scripts/build-training-set.js dari data sintetis).
Split berdasarkan waktu (minggu 1-8 latih, sisanya uji). Satu modus (hold-out) tidak dipakai melatih model supervised.
Jalankan: uvicorn app:app --port 4106
"""
import hashlib
import hmac
import os
import re
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, field_validator
from sklearn.metrics import average_precision_score, roc_auc_score

import kaggle_model
from models import META_COLS, fit, load_rows

TRAIN_CSV = Path(os.environ.get("ML_TRAIN_CSV", Path(__file__).parent / "data" / "train.csv"))
INTERNAL_KEY = os.environ.get("INTERNAL_API_KEY", "")
TRAIN_DAYS = int(os.environ.get("ML_TRAIN_DAYS", "56"))
HERE = Path(__file__).parent
DATA_DIR = Path(os.environ.get("ML_DATA_DIR", HERE / "data"))
MODEL_DIR = Path(os.environ.get("ML_MODEL_DIR", HERE / "models"))
REPORT_PATH = Path(os.environ.get("ML_REPORT_PATH", HERE.parent.parent / "reports" / "ml-metrics.json"))

app = FastAPI(title="SAMAR ml", docs_url=None, redoc_url=None, openapi_url=None)
state: dict = {}


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    # Bawaan FastAPI memantulkan nilai yang ditolak (bisa berupa NIK). Kembalikan hanya lokasi dan jenis galat.
    detail = [{"loc": e["loc"], "type": e["type"]} for e in exc.errors()]
    return JSONResponse({"error": {"code": "INVALID_REQUEST", "message": "Permintaan tidak valid", "detail": detail}}, status_code=422)


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

    iforest, sup, sup_mask = fit(X, y, hold, is_train)
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
state["kaggle"] = kaggle_model.load_latest(MODEL_DIR)


@app.middleware("http")
async def internal_key(request: Request, call_next):
    if request.url.path != "/health" and INTERNAL_KEY and not hmac.compare_digest(request.headers.get("x-internal-key", ""), INTERNAL_KEY):
        return JSONResponse({"error": {"code": "UNAUTHENTICATED", "message": "Kunci antar-layanan tidak valid"}}, status_code=401)
    return await call_next(request)


NIK_LIKE = re.compile(r"\d{16}")
TOKEN = re.compile(r"^PSE_[A-Z]{3}_[0-9A-F]{20}$")


class ScoreRequest(BaseModel):
    """Zona token: hanya token dan id faskes. Field lain ditolak; string berpola NIK ditolak."""
    model_config = ConfigDict(extra="forbid")
    subject_token: str | None = None
    faskes_id: str | None = None
    features: dict[str, float]

    @field_validator("subject_token")
    @classmethod
    def token_only(cls, v):
        if v is not None and not TOKEN.match(v):
            raise ValueError("subject_token harus berformat token PSE_XXX_<20 hex>")
        return v

    @field_validator("faskes_id")
    @classmethod
    def faskes_plain(cls, v):
        if v is not None and (NIK_LIKE.search(v) or not re.fullmatch(r"[A-Za-z0-9_-]{2,40}", v)):
            raise ValueError("faskes_id tidak valid")
        return v


class Feedback(BaseModel):
    model_config = ConfigDict(extra="forbid")
    faskes_id: str
    label: int


class TrainRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    feedback: list[Feedback] = []


@app.get("/health")
def health():
    return {"ok": True, "service": "ml", "model_ready": "sup" in state or state.get("kaggle") is not None}


@app.get("/model")
def model():
    kg = state.get("kaggle")
    if "sup" not in state and kg is None:
        raise HTTPException(503, "Model belum dilatih. Jalankan npm run ml:train")
    out = {}
    if "sup" in state:
        out.update({"version": state["version"], "features": state["features"], "metrics": state["metrics"], "algorithms": ["IsolationForest", "GradientBoostingClassifier+StandardScaler"]})
    if kg is not None:
        out["kaggle"] = {"version": kg["version"], "trained_at": kg["trained_at"], "metrics": kg["metrics"], "algorithms": ["IsolationForest (per klaim)", "RandomForestClassifier (per penyedia)"]}
        out.setdefault("version", kg["version"])
    return out


@app.post("/train")
def retrain(req: TrainRequest):
    """Latih ulang model Kaggle dari data ter-token + label penyedia + keputusan verifikator (1 = terkonfirmasi, 0 = ditolak)."""
    claims_path, truth_path = DATA_DIR / "claims_tokenized.csv", DATA_DIR / "truth_provider.csv"
    if not claims_path.exists() or not truth_path.exists():
        raise HTTPException(409, "Data latih belum ada. Jalankan npm run ml:train")
    if any(f.label not in (0, 1) for f in req.feedback):
        raise HTTPException(422, "label umpan balik harus 0 atau 1")
    try:
        art = kaggle_model.train(pd.read_csv(claims_path, dtype=str), pd.read_csv(truth_path), [f.model_dump() for f in req.feedback], MODEL_DIR, REPORT_PATH)
    except ValueError as err:
        raise HTTPException(422, str(err))
    state["kaggle"] = art
    return {"version": art["version"], "metrics": art["metrics"]}


@app.post("/score")
def score(req: ScoreRequest):
    kg = state.get("kaggle")
    if kg is not None and req.faskes_id:
        res = kaggle_model.score(kg, req.faskes_id, req.features)
        if res is not None:
            return res
    if "sup" not in state:
        raise HTTPException(503, "Model belum dilatih. Jalankan npm run ml:train")
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
