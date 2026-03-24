from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # App
    SECRET_KEY: str = "change-me-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24

    # Owner auth — injected as env vars by Docker Compose env_file
    OWNER_USERNAME: str = "admin"
    OWNER_PASSWORD_HASH: str = ""

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://kronos:kronos@postgres:5432/kronos"

    # Redis
    REDIS_URL: str = "redis://redis:6379"

    # Ollama
    OLLAMA_BASE_URL: str = "http://ollama:11434"

    # ChromaDB
    CHROMA_HOST: str = "chromadb"
    CHROMA_PORT: int = 8000
    CHROMA_PERSIST_DIR: str = "/chroma_data"

    # Docker
    DOCKER_SOCKET: str = "unix:///var/run/docker.sock"
    KRONOS_WORKER_NETWORK: str = "kronos_workers"

    # Embeddings
    EMBED_MODEL: str = "nomic-embed-text"
    EMBED_CHUNK_SIZE: int = 512
    EMBED_CHUNK_OVERLAP: int = 64

    model_config = {
        "env_file": None,          # Do NOT read a file — env vars are injected by Docker Compose
        "case_sensitive": False,   # Allow lowercase env var names too
    }


settings = Settings()
