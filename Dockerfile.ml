# Layanan ml (Python/FastAPI) untuk docker compose. Model dilatih saat start dari data/train.csv sintetis
# (dibuat host lewat `npm run demo:reset`, di-mount read-only). Tanpa berkas itu layanan hidup tetapi model belum siap
# dan gateway memakai aturan saja.
FROM python:3.12-slim
WORKDIR /app
COPY services/ml/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY services/ml/app.py services/ml/models.py services/ml/features.py services/ml/kaggle_model.py ./
RUN useradd --system --no-create-home samar
USER samar
ENV ML_TRAIN_CSV=/app/data/train.csv
EXPOSE 4106
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "4106", "--log-level", "warning"]
