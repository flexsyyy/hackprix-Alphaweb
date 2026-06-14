from __future__ import annotations

import json
import os
from typing import Dict, Optional


def env(key: str, default: str = "") -> str:
    return os.getenv(key, default)


class Settings:
    # FastAPI / container
    ORCHESTRATOR_HOST: str = env("ORCHESTRATOR_HOST", "0.0.0.0")
    ORCHESTRATOR_PORT: int = int(env("ORCHESTRATOR_PORT", "8000"))

    # Layer 1 — Gemma execution agent (Ollama)
    # Picks which tool(s) to run from a natural-language request.
    GEMMA_ENABLED: bool = env("GEMMA_ENABLED", "true").lower() in ("1", "true", "yes")
    OLLAMA_URL: str = env("OLLAMA_URL", "http://127.0.0.1:11434")
    GEMMA_MODEL: str = env("GEMMA_MODEL", "qwen2.5:1.5b")
    GEMMA_TEMPERATURE: float = float(env("GEMMA_TEMPERATURE", "0.0"))
    # GPU layers for the routing model. -1 = let Ollama auto-fit (qwen2.5:1.5b
    # is ~1GB so it can share the GPU). 0 = force CPU.
    GEMMA_NUM_GPU: int = int(env("GEMMA_NUM_GPU", "-1"))
    GEMMA_TIMEOUT_SECS: int = int(env("GEMMA_TIMEOUT_SECS", "60"))
    # Selection below this confidence falls back to keyword detection.
    GEMMA_CONFIDENCE_THRESHOLD: float = float(env("GEMMA_CONFIDENCE_THRESHOLD", "0.5"))

    # BaronLLM
    BARONLLM_MODEL_PATH: str = env("BARONLLM_MODEL_PATH", "models/barronllm.gguf")
    BARONLLM_N_CTX: int = int(env("BARONLLM_N_CTX", "4096"))
    # BaronLLM (Layer 2, summary) runs on GPU — it is the big cybersec-tuned
    # model and benefits most from acceleration. Layer 1 routing (llama3.2)
    # runs on CPU instead, since both cannot fit on an 8GB card together.
    BARONLLM_N_GPU_LAYERS: int = int(env("BARONLLM_N_GPU_LAYERS", "35"))
    BARONLLM_TEMPERATURE: float = float(env("BARONLLM_TEMPERATURE", "0.1"))
    BARONLLM_CONFIDENCE_THRESHOLD: float = float(env("BARONLLM_CONFIDENCE_THRESHOLD", "0.7"))

    # Database
    # PostgreSQL by default. Override DATABASE_URL to point elsewhere (e.g. a
    # managed instance) or set the discrete POSTGRES_* vars below. The
    # docker-compose stack provides a matching `db` service on port 5432.
    POSTGRES_USER: str = env("POSTGRES_USER", "alphaweb")
    POSTGRES_PASSWORD: str = env("POSTGRES_PASSWORD", "alphaweb")
    POSTGRES_HOST: str = env("POSTGRES_HOST", "localhost")
    POSTGRES_PORT: str = env("POSTGRES_PORT", "5432")
    POSTGRES_DB: str = env("POSTGRES_DB", "alphaweb")
    DATABASE_URL: str = env(
        "DATABASE_URL",
        f"postgresql+psycopg2://{POSTGRES_USER}:{POSTGRES_PASSWORD}"
        f"@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}",
    )

    # Docker
    DOCKER_SOCKET: str = env("DOCKER_SOCKET", "unix:///var/run/docker.sock")

    # Tool images
    TOOL_IMAGE_PREFIX: str = env("TOOL_IMAGE_PREFIX", "")
    TOOL_IMAGES_JSON: Optional[str] = os.getenv("TOOL_IMAGES_JSON") or None

    # Host data directory for john tool
    HOST_DATA_DIR: str = env("HOST_DATA_DIR", "./data")
    JOHN_LOCAL_DATA_DIR: str = env("JOHN_LOCAL_DATA_DIR", "./data")
    CONTAINER_DATA_DIR: str = env("CONTAINER_DATA_DIR", "/data")
    JOHN_WORDLIST_MOUNT_MODE: str = env("JOHN_WORDLIST_MOUNT_MODE", "host_path")

    # Tool execution
    DEFAULT_TOOL_TIMEOUT: int = int(env("DEFAULT_TOOL_TIMEOUT", "300"))
    TOOL_EXECUTION_TIMEOUT_SECS: int = int(env("TOOL_EXECUTION_TIMEOUT_SECS", "900"))
    TOOL_OUTPUT_MAX_CHARS: int = int(env("TOOL_OUTPUT_MAX_CHARS", "200000"))

    # Rate limiting
    MAX_CONCURRENT_SCANS: int = int(env("MAX_CONCURRENT_SCANS", "5"))
    SCANS_PER_HOUR_LIMIT: int = int(env("SCANS_PER_HOUR_LIMIT", "10"))

    # Queue
    MAX_QUEUE_DEPTH: int = int(env("MAX_QUEUE_DEPTH", "50"))

    # Phase 2: Workflow / Orchestration
    # Hard cap: at most 3 tools run per scan/chat request — prevents the
    # decision chain from ballooning and "running tools on its own".
    MAX_TOOLS_PER_SCAN: int = int(env("MAX_TOOLS_PER_SCAN", "3"))
    WORKFLOW_MAX_DEPTH: int = int(env("WORKFLOW_MAX_DEPTH", "3"))
    WORKFLOW_MAX_TOOLS: int = int(env("WORKFLOW_MAX_TOOLS", "3"))
    ORCHESTRATION_CONFIDENCE_THRESHOLD: float = float(env("ORCHESTRATION_CONFIDENCE_THRESHOLD", "0.75"))

    # Docker resource limits
    DOCKER_MEMORY_LIMIT: str = env("DOCKER_MEMORY_LIMIT", "512m")
    DOCKER_CPU_LIMIT: str = env("DOCKER_CPU_LIMIT", "1.0")

    # Logging
    LOG_LEVEL: str = env("LOG_LEVEL", "INFO")
    LOG_DIR: str = env("LOG_DIR", "./logs")
    LOG_FILE: str = env("LOG_FILE", "./logs/orchestrator.log")

    @classmethod
    def tool_images(cls) -> Dict[str, str]:
        if not cls.TOOL_IMAGES_JSON:
            return {}
        try:
            raw = json.loads(cls.TOOL_IMAGES_JSON)
            if not isinstance(raw, dict):
                return {}
            return {str(k): str(v) for k, v in raw.items()}
        except Exception:
            return {}

    @classmethod
    def get_tool_image(cls, tool_name: str) -> str:
        override = cls.tool_images().get(tool_name)
        if override:
            return override
        return f"{cls.TOOL_IMAGE_PREFIX}{tool_name}"
