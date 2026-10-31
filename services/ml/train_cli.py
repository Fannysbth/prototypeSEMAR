"""Latih model Kaggle tanpa layanan HTTP (dipanggil npm run ml:train bila ml belum hidup). Umpan balik JSON lewat stdin."""
import json
import os
import sys
from pathlib import Path

import pandas as pd

import kaggle_model

HERE = Path(__file__).parent
data = Path(os.environ.get("ML_DATA_DIR", HERE / "data"))
feedback = json.loads(sys.stdin.read() or "[]")
art = kaggle_model.train(
    pd.read_csv(data / "claims_tokenized.csv", dtype=str), pd.read_csv(data / "truth_provider.csv"), feedback,
    Path(os.environ.get("ML_MODEL_DIR", HERE / "models")), Path(os.environ.get("ML_REPORT_PATH", HERE.parent.parent / "reports" / "ml-metrics.json")),
)
print(f"Model {art['version']}: " + json.dumps({k: art['metrics'][k] for k in ('pr_auc', 'roc_auc', 'precision_at_k', 'recall_at_k')}))
