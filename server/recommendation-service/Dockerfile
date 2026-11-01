FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY server/recommendation-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY server/recommendation-service/app ./app
RUN mkdir -p /models

EXPOSE 4010
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4010"]
