"""Tes layanan ml: bentuk respons /score dan penolakan PII. Data latih dibuat kecil di direktori sementara."""
import importlib
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

TOKEN = "PSE_FRD_0123456789ABCDEF0123"


def _claims(rng):
    rows, truth = [], []
    for p in range(30):
        fraud = p < 8
        fid = f"PRV{p:03d}"
        truth.append({"faskes_id": fid, "label": int(fraud)})
        for i in range(40):
            tok = f"PSE_KGL_{(p * 7 + i) % 25:020X}"
            day = pd.Timestamp("2009-01-01") + pd.Timedelta(days=int(rng.integers(0, 300)))
            los = int(rng.integers(3, 8)) if fraud else int(rng.integers(0, 3))
            rows.append({
                "subject_token": tok, "faskes_id": fid, "jenis_layanan": "RI" if fraud or i % 4 == 0 else "RJ",
                "tgl_masuk": day.date().isoformat(), "tgl_pulang": (day + pd.Timedelta(days=los)).date().isoformat(),
                "diag_utama": str(4000 + i % 5), "n_diag": 3, "prosedur": "4019|3722" if fraud else "", "inacbg": "201",
                "FKL47": float(rng.integers(5000, 9000) if fraud else rng.integers(50, 4000)), "attending_physician": f"PHY{p}{i % 3}",
            })
    return pd.DataFrame(rows), pd.DataFrame(truth)


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("ml")
    claims, truth = _claims(np.random.default_rng(0))
    claims.to_csv(tmp / "claims_tokenized.csv", index=False)
    truth.to_csv(tmp / "truth_provider.csv", index=False)
    os.environ.update({
        "ML_DATA_DIR": str(tmp), "ML_MODEL_DIR": str(tmp / "models"), "ML_REPORT_PATH": str(tmp / "ml-metrics.json"),
        "ML_TRAIN_CSV": str(tmp / "tidak-ada.csv"), "INTERNAL_API_KEY": "",
    })
    sys.modules.pop("app", None)
    app = importlib.import_module("app")
    c = TestClient(app.app)
    assert c.post("/train", json={}).status_code == 200
    return c


def test_score_shape_and_ranges(client):
    r = client.post("/score", json={"subject_token": TOKEN, "faskes_id": "PRV000", "features": {"n_faskes_30d": 3, "overlap_inap_hari": 4}})
    assert r.status_code == 200
    body = r.json()
    assert set(body) >= {"if_score", "sup_score", "model_version", "top_features"}
    assert 0 <= body["if_score"] <= 1 and 0 <= body["sup_score"] <= 1
    assert len(body["top_features"]) <= 3
    assert body["model_version"].startswith("kaggle-")


def test_fraud_provider_scores_above_normal_provider(client):
    hi = client.post("/score", json={"faskes_id": "PRV001", "features": {}}).json()["sup_score"]
    lo = client.post("/score", json={"faskes_id": "PRV029", "features": {}}).json()["sup_score"]
    assert hi > lo


def test_score_rejects_pii_and_unknown_fields(client):
    nik = "9999000011112222"
    assert client.post("/score", json={"subject_token": nik, "faskes_id": "PRV000", "features": {}}).status_code == 422
    assert client.post("/score", json={"faskes_id": f"RS-{nik}", "features": {}}).status_code == 422
    assert client.post("/score", json={"faskes_id": "PRV000", "features": {}, "patient_name": "Budi Santoso"}).status_code == 422
    assert nik not in client.post("/score", json={"faskes_id": f"RS-{nik}", "features": {}}).text


def test_model_reports_version_and_validation_metrics(client):
    kg = client.get("/model").json()["kaggle"]
    assert kg["version"].startswith("kaggle-")
    assert {"pr_auc", "roc_auc", "precision_at_k", "recall_at_k", "fitur_dilewati"} <= set(kg["metrics"])
    assert "referral_loop" in kg["metrics"]["fitur_dilewati"]


def test_train_accepts_verifier_feedback(client):
    r = client.post("/train", json={"feedback": [{"faskes_id": "PRV029", "label": 1}]})
    assert r.status_code == 200 and r.json()["metrics"]["n_umpan_balik"] == 1
    assert client.post("/train", json={"feedback": [{"faskes_id": "PRV029", "label": 7}]}).status_code == 422
