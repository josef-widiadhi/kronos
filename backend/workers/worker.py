"""
KRONOS Worker — runs inside each deployed agent container.
Provides:
- /chat endpoint: RAG-augmented chat with the baked KB
- /health: status
- /activity: what this worker is currently doing (for monitor)
"""
import os
import json
import uuid
from typing import Optional
from datetime import datetime

import httpx
import chromadb
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title=f"KRONOS Worker: {os.getenv('KRONOS_AGENT_NAME', 'unnamed')}")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Config from env ───────────────────────────────────────────────────────────

AGENT_ID = os.getenv("KRONOS_AGENT_ID", str(uuid.uuid4()))
AGENT_NAME = os.getenv("KRONOS_AGENT_NAME", "Worker")
MODEL = os.getenv("KRONOS_MODEL", "llama3.2")
OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
CHROMA_COLLECTION = os.getenv("CHROMA_COLLECTION", "")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")
SYSTEM_PROMPT = os.getenv(
    "SYSTEM_PROMPT",
    "You are a helpful AI assistant with specialized knowledge. Use the provided context to answer questions accurately."
)

# ── State ─────────────────────────────────────────────────────────────────────

current_activity = {"status": "idle", "last_query": None, "query_count": 0}

# ── ChromaDB ──────────────────────────────────────────────────────────────────

def get_chroma_collection():
    if not CHROMA_COLLECTION:
        return None
    try:
        client = chromadb.PersistentClient(path=f"/root/.chroma")
        return client.get_collection(CHROMA_COLLECTION)
    except Exception:
        return None


# ── Embed via Ollama ──────────────────────────────────────────────────────────

async def embed(text: str) -> list:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
        )
        return r.json()["embedding"]


# ── Schemas ───────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    history: Optional[list] = None
    top_k: int = 5


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "agent_id": AGENT_ID,
        "agent_name": AGENT_NAME,
        "model": MODEL,
        "kb_loaded": bool(CHROMA_COLLECTION),
        "status": "running",
    }


@app.get("/activity")
async def activity():
    return {**current_activity, "agent_name": AGENT_NAME, "model": MODEL}


@app.post("/chat")
async def chat(req: ChatRequest):
    global current_activity
    current_activity = {
        "status": "processing",
        "last_query": req.message[:80],
        "query_count": current_activity["query_count"] + 1,
        "started_at": datetime.utcnow().isoformat(),
    }

    # 1. RAG retrieval
    context = ""
    sources = []
    collection = get_chroma_collection()
    if collection:
        try:
            query_embedding = await embed(req.message)
            results = collection.query(
                query_embeddings=[query_embedding],
                n_results=req.top_k,
                include=["documents", "metadatas", "distances"],
            )
            context_parts = []
            for i, (doc, meta, dist) in enumerate(zip(
                results["documents"][0],
                results["metadatas"][0],
                results["distances"][0],
            )):
                context_parts.append(f"[Context {i+1}] {doc}")
                sources.append({"source": meta.get("source", "unknown"), "relevance": round(1 - dist, 3)})
            context = "\n\n".join(context_parts)
        except Exception as e:
            context = ""

    # 2. Build messages
    messages = []
    system = SYSTEM_PROMPT
    if context:
        system += f"\n\nRelevant context from knowledge base:\n{context}"

    if req.history:
        messages = req.history

    messages.append({"role": "user", "content": req.message})

    # 3. Ollama chat
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": MODEL,
                "messages": [{"role": "system", "content": system}] + messages,
                "stream": False,
            },
        )
        r.raise_for_status()
        response_data = r.json()

    reply = response_data["message"]["content"]
    current_activity["status"] = "idle"

    return {
        "reply": reply,
        "sources": sources,
        "model": MODEL,
        "kb_used": bool(context),
        "agent": AGENT_NAME,
    }
