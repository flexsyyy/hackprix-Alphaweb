FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Native libs required by weasyprint (pulled in by subdominator).
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libgdk-pixbuf-2.0-0 \
        libffi-dev \
        libcairo2 \
        shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir subdominator

ENTRYPOINT ["subdominator"]
