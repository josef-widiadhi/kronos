"""
Chat router — test a KB+model combo without deploying.
Runs RAG inference directly from the KRONOS backend.
"""
from typing import Optional, List

import httpx
import chromadb
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.config import settings
from core.database import get_db, KBCollection
from routers.auth import get_current_owner

router = APIRouter()


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str
    message: str
    kb_collection_id: Optional[str] = None
    history: Optional[List[ChatMessage]] = None
    top_k: int = 5
    stream: bool = False


async def embed_text(text: str, model: str) -> list:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{settings.OLLAMA_BASE_URL}/api/embeddings",
            json={"model": model, "prompt": text},
        )
        return r.json()["embedding"]


@router.post("/")
async def chat(
    req: ChatRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """
    RAG-augmented chat for testing models before deployment.
    Optionally attach a KB collection for RAG retrieval.
    """
    kb = None
    context = ""
    sources = []

    if req.kb_collection_id:
        result = await db.execute(
            select(KBCollection).where(KBCollection.id == req.kb_collection_id)
        )
        kb = result.scalar_one_or_none()
        if not kb:
            raise HTTPException(status_code=404, detail="KB Collection not found")

        # RAG retrieval
        try:
            chroma = chromadb.HttpClient(host=settings.CHROMA_HOST, port=settings.CHROMA_PORT, tenant=chromadb.DEFAULT_TENANT, database=chromadb.DEFAULT_DATABASE)
            collection = chroma.get_or_create_collection(kb.chroma_collection)
            query_emb = await embed_text(req.message, model=kb.embed_model)
            results = collection.query(
                query_embeddings=[query_emb],
                n_results=req.top_k,
                include=["documents", "metadatas", "distances"],
            )
            for doc, meta, dist in zip(
                results["documents"][0],
                results["metadatas"][0],
                results["distances"][0],
            ):
                context += f"\n[Source: {meta.get('source','unknown')}]\n{doc}\n"
                sources.append({"source": meta.get("source"), "relevance": round(1 - dist, 3)})
        except Exception as e:
            pass  # Graceful degradation — answer without RAG

    # Build system prompt
    system_prompt = "You are a helpful AI assistant."
    if kb:
        system_prompt = (
            f"You are an AI assistant specialized in the knowledge base '{kb.name}'. "
            "Answer questions using ONLY the provided context. "
            "If the answer is not in the context, say so clearly."
        )
    if context:
        system_prompt += f"\n\nKnowledge base context:\n{context}"

    # Build message list
    messages = [{"role": "system", "content": system_prompt}]
    if req.history:
        messages += [{"role": m.role, "content": m.content} for m in req.history]
    messages.append({"role": "user", "content": req.message})

    if req.stream:
        async def stream_response():
            async with httpx.AsyncClient(timeout=120) as client:
                async with client.stream(
                    "POST",
                    f"{settings.OLLAMA_BASE_URL}/api/chat",
                    json={"model": req.model, "messages": messages, "stream": True},
                ) as response:
                    async for line in response.aiter_lines():
                        if line:
                            yield line + "\n"

        return StreamingResponse(stream_response(), media_type="application/x-ndjson")

    # Non-streaming
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{settings.OLLAMA_BASE_URL}/api/chat",
            json={"model": req.model, "messages": messages, "stream": False},
        )
        r.raise_for_status()
        data = r.json()

    return {
        "reply": data["message"]["content"],
        "model": req.model,
        "kb": kb.name if kb else None,
        "sources": sources,
        "rag_used": bool(context),
        "tokens": data.get("eval_count"),
    }
