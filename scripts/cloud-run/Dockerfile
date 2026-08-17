FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY toki_server.py /app/scripts/toki_server.py
ENV TOKI_API_ONLY=1
ENV PYTHONUNBUFFERED=1
CMD ["python3", "scripts/toki_server.py"]
