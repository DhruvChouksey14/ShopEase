FROM python:3.12-slim AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY server/recommendation-service/requirements.txt ./requirements.txt
RUN pip wheel --no-cache-dir -r requirements.txt -w /wheels

FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OPENBLAS_NUM_THREADS=1

WORKDIR /app
COPY server/recommendation-service/requirements.txt ./requirements.txt
COPY --from=builder /wheels /wheels
RUN pip install --no-cache-dir --no-index --find-links=/wheels -r requirements.txt \
    && rm -rf /wheels

COPY server/recommendation-service/app ./app
RUN mkdir -p /models

EXPOSE 4010
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4010"]
