"""Fitur dari klaim ter-token (tanpa PII). Dipakai pelatihan; /score menerima fitur klaim yang sama dari layanan fraud.

Kolom masukan: subject_token, faskes_id, jenis_layanan (RI/RJ), tgl_masuk, tgl_pulang, diag_utama, n_diag,
prosedur (dipisah |), inacbg (DRG), FKL47 (USD), attending_physician.
Kode diagnosis ICD-9 dan nilai USD (dataset Kaggle); label hanya per penyedia.
"""
import numpy as np
import pandas as pd

CLAIM_FEATURES = [
    "n_faskes_30d", "n_kunjungan_30d", "overlap_inap_hari", "same_diag_multi_faskes_14d",
    "los_vs_median_drg", "billed_vs_median_drg", "n_prosedur", "n_diag",
]
# Fitur di docs/05-ml-evaluasi.md yang datanya tidak ada pada dataset Kaggle: dilewati dan dicatat di metrik.
SKIPPED_FEATURES = {
    "referral_loop": "dataset tidak memuat faskes perujuk",
    "selisih_tagih_verifikasi": "FKL48 (nilai verifikasi) kosong",
    "jarak_kab_kota_faskes": "lokasi penyedia tidak ada",
}
FASKES_FEATURES = [
    "billed_mean", "billed_std", "los_mean", "los_std", "share_multi_faskes_patients", "n_dokter",
    "rasio_rawat_inap", "n_klaim", *[f"mean_{f}" for f in CLAIM_FEATURES],
]
NEUTRAL = {"n_faskes_30d": 1.0, "n_kunjungan_30d": 1.0, "overlap_inap_hari": 0.0, "same_diag_multi_faskes_14d": 0.0,
           "los_vs_median_drg": 1.0, "billed_vs_median_drg": 1.0, "n_prosedur": 0.0, "n_diag": 1.0}


def prepare(df: pd.DataFrame) -> pd.DataFrame:
    d = df.copy()
    d["tgl_masuk"] = pd.to_datetime(d["tgl_masuk"])
    d["tgl_pulang"] = pd.to_datetime(d["tgl_pulang"]).fillna(d["tgl_masuk"])
    d["los"] = ((d["tgl_pulang"] - d["tgl_masuk"]).dt.days).clip(lower=1)  # rawat jalan satu hari = 1, sama dengan unggahan
    d["billed"] = pd.to_numeric(d["FKL47"], errors="coerce").fillna(0.0)
    d["n_prosedur"] = d["prosedur"].fillna("").map(lambda s: len([p for p in str(s).split("|") if p]))
    d["n_diag"] = pd.to_numeric(d["n_diag"], errors="coerce").fillna(1)
    return d.sort_values(["subject_token", "tgl_masuk"], kind="stable").reset_index(drop=True)


def _ratio_to_median(d: pd.DataFrame, col: str) -> pd.Series:
    key = np.where(d["jenis_layanan"] == "RI", "RI:" + d["inacbg"].fillna("").astype(str), "RJ:" + d["diag_utama"].fillna("").astype(str))
    med = d.groupby(key)[col].transform("median")
    level_med = d.groupby("jenis_layanan")[col].transform("median")
    ref = med.where(med > 0, level_med).replace(0, np.nan)
    return (d[col] / ref).fillna(1.0)


def claim_features(df: pd.DataFrame) -> pd.DataFrame:
    """Satu baris fitur per klaim, urutan sama dengan hasil prepare(df)."""
    d = prepare(df)
    n = len(d)
    out = {f: np.zeros(n) for f in CLAIM_FEATURES}
    fcode = pd.factorize(d["faskes_id"])[0]
    dcode = pd.factorize(d["diag_utama"].fillna(""))[0]
    day = (d["tgl_masuk"] - pd.Timestamp("1970-01-01")).dt.days.to_numpy()
    end = day + d["los"].to_numpy()
    inpatient = (d["jenis_layanan"] == "RI").to_numpy()
    for idx in d.groupby("subject_token", sort=False).indices.values():
        f, dd, e, dg, ri = fcode[idx], day[idx], end[idx], dcode[idx], inpatient[idx]
        for a, i in enumerate(idx):
            gap = np.abs(dd - dd[a])
            near = gap <= 30
            other = f != f[a]
            out["n_faskes_30d"][i] = len(set(f[near]))
            out["n_kunjungan_30d"][i] = near.sum()
            both = near & other & ri & ri[a]
            out["overlap_inap_hari"][i] = np.maximum(0, np.minimum(e[both], e[a]) - np.maximum(dd[both], dd[a])).sum()
            same = other & (gap <= 14) & (dg == dg[a])
            out["same_diag_multi_faskes_14d"][i] = len(set(f[same]))
    out["los_vs_median_drg"] = _ratio_to_median(d, "los").to_numpy()
    out["billed_vs_median_drg"] = _ratio_to_median(d, "billed").to_numpy()
    out["n_prosedur"] = d["n_prosedur"].to_numpy(dtype=float)
    out["n_diag"] = d["n_diag"].to_numpy(dtype=float)
    res = pd.DataFrame(out)
    res.insert(0, "faskes_id", d["faskes_id"].to_numpy())
    res.insert(0, "subject_token", d["subject_token"].to_numpy())
    return res


def faskes_features(df: pd.DataFrame, cf: pd.DataFrame) -> pd.DataFrame:
    """Agregat per penyedia. cf berasal dari claim_features(df)."""
    d = prepare(df)
    for c in CLAIM_FEATURES:
        if c not in d.columns:
            d[c] = cf[c].to_numpy()
    d["multi"] = (d.groupby("subject_token")["faskes_id"].transform("nunique") > 1).astype(float)
    d["ri"] = (d["jenis_layanan"] == "RI").astype(float)
    g = d.groupby("faskes_id")
    agg = pd.DataFrame({
        "billed_mean": g["billed"].mean(), "billed_std": g["billed"].std().fillna(0.0),
        "los_mean": g["los"].mean(), "los_std": g["los"].std().fillna(0.0),
        "share_multi_faskes_patients": g["multi"].mean(),
        "n_dokter": g["attending_physician"].nunique(), "rasio_rawat_inap": g["ri"].mean(), "n_klaim": g.size().astype(float),
    })
    for c in CLAIM_FEATURES:
        agg[f"mean_{c}"] = g[c].mean()
    return agg[FASKES_FEATURES]
