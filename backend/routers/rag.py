"""
RAG Builder router.
- Create a KB collection (name it, pick model)
- Ingest: file upload, URL, folder path, or raw text
- Query (for testing)
- Delete collection
"""
import os
import uuid
import tempfile
from pathlib import Path
from typing import Optional, List

import httpx
import chromadb
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from core.config import settings
from core.database import get_db, KBCollection
from routers.auth import get_current_owner

router = APIRouter()

# ── ChromaDB client ───────────────────────────────────────────────────────────

def get_chroma():
    import time
    last_err = None
    for attempt in range(3):
        try:
            client = chromadb.HttpClient(
                host=settings.CHROMA_HOST,
                port=settings.CHROMA_PORT,
                tenant=chromadb.DEFAULT_TENANT,
                database=chromadb.DEFAULT_DATABASE,
            )
            # Verify connection is alive
            client.heartbeat()
            return client
        except Exception as e:
            last_err = e
            if attempt < 2:
                time.sleep(2)
    raise Exception(f"ChromaDB not reachable after 3 attempts: {last_err}")


# ── Embedding via Ollama ──────────────────────────────────────────────────────

async def embed_texts(texts: List[str], model: str = None) -> List[List[float]]:
    model = model or settings.EMBED_MODEL
    embeddings = []
    async with httpx.AsyncClient(timeout=60) as client:
        for text in texts:
            r = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/embeddings",
                json={"model": model, "prompt": text},
            )
            r.raise_for_status()
            embeddings.append(r.json()["embedding"])
    return embeddings


# ── Text chunking ─────────────────────────────────────────────────────────────

def chunk_text(text: str, chunk_size: int = None, overlap: int = None) -> List[str]:
    chunk_size = chunk_size or settings.EMBED_CHUNK_SIZE
    overlap = overlap or settings.EMBED_CHUNK_OVERLAP
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i : i + chunk_size])
        chunks.append(chunk)
        i += chunk_size - overlap
    return chunks


# ── Schemas ───────────────────────────────────────────────────────────────────

class CollectionCreate(BaseModel):
    name: str
    description: Optional[str] = None
    model: str
    embed_model: Optional[str] = None


class URLIngestRequest(BaseModel):
    collection_id: str
    urls: List[str]


class QueryRequest(BaseModel):
    collection_id: str
    query: str
    top_k: int = 5


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/collections")
async def list_collections(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(select(KBCollection).order_by(KBCollection.created_at.desc()))
    return result.scalars().all()


@router.post("/collections")
async def create_collection(
    req: CollectionCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    chroma_name = f"kb_{req.name.lower().replace(' ', '_')}_{uuid.uuid4().hex[:8]}"
    try:
        chroma = get_chroma()
        chroma.get_or_create_collection(chroma_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ChromaDB error: {e}")

    kb = KBCollection(
        name=req.name,
        description=req.description,
        model=req.model,
        embed_model=req.embed_model or settings.EMBED_MODEL,
        chroma_collection=chroma_name,
        source_type="mixed",
    )
    db.add(kb)
    await db.commit()
    await db.refresh(kb)
    return kb


@router.delete("/collections/{collection_id}")
async def delete_collection(
    collection_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(select(KBCollection).where(KBCollection.id == collection_id))
    kb = result.scalar_one_or_none()
    if not kb:
        raise HTTPException(status_code=404, detail="Collection not found")

    try:
        chroma = get_chroma()
        chroma.delete_collection(kb.chroma_collection)
    except Exception:
        pass  # Best-effort

    await db.delete(kb)
    await db.commit()
    return {"deleted": collection_id}


@router.post("/ingest/file")
async def ingest_file(
    collection_id: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Ingest a file (PDF, TXT, MD, DOCX) into a KB collection."""
    result = await db.execute(select(KBCollection).where(KBCollection.id == collection_id))
    kb = result.scalar_one_or_none()
    if not kb:
        raise HTTPException(status_code=404, detail="Collection not found")

    content = await file.read()
    text = ""

    if file.filename.endswith(".txt") or file.filename.endswith(".md"):
        text = content.decode("utf-8", errors="ignore")
    elif file.filename.endswith(".pdf"):
        try:
            import pypdf
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            reader = pypdf.PdfReader(tmp_path)
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
            os.unlink(tmp_path)
        except ImportError:
            raise HTTPException(status_code=400, detail="pypdf not installed for PDF ingestion")
    elif file.filename.endswith(".docx"):
        try:
            import docx
            with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            doc = docx.Document(tmp_path)
            text = "\n".join(p.text for p in doc.paragraphs)
            os.unlink(tmp_path)
        except ImportError:
            raise HTTPException(status_code=400, detail="python-docx not installed")

    if not text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from file")

    chunks = chunk_text(text)
    embeddings = await embed_texts(chunks, model=kb.embed_model)

    chroma = get_chroma()
    collection = chroma.get_or_create_collection(kb.chroma_collection)
    ids = [str(uuid.uuid4()) for _ in chunks]
    collection.add(
        ids=ids,
        embeddings=embeddings,
        documents=chunks,
        metadatas=[{"source": file.filename, "chunk_idx": i} for i, _ in enumerate(chunks)],
    )

    await db.execute(
        update(KBCollection)
        .where(KBCollection.id == collection_id)
        .values(doc_count=KBCollection.doc_count + len(chunks))
    )
    await db.commit()

    return {"ingested_chunks": len(chunks), "file": file.filename, "collection": kb.name}


@router.post("/ingest/url")
async def ingest_url(
    req: URLIngestRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Crawl and ingest URLs into a KB collection."""
    result = await db.execute(select(KBCollection).where(KBCollection.id == req.collection_id))
    kb = result.scalar_one_or_none()
    if not kb:
        raise HTTPException(status_code=404, detail="Collection not found")

    total_chunks = 0
    errors = []

    for url in req.urls:
        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                r = await client.get(url, headers={"User-Agent": "KRONOS/1.0 RAG Ingester"})
                r.raise_for_status()
                # Basic HTML → text strip
                text = r.text
                # Remove HTML tags simply
                import re
                text = re.sub(r"<[^>]+>", " ", text)
                text = re.sub(r"\s+", " ", text).strip()

            chunks = chunk_text(text)
            embeddings = await embed_texts(chunks, model=kb.embed_model)

            chroma = get_chroma()
            collection = chroma.get_or_create_collection(kb.chroma_collection)
            ids = [str(uuid.uuid4()) for _ in chunks]
            collection.add(
                ids=ids,
                embeddings=embeddings,
                documents=chunks,
                metadatas=[{"source": url, "chunk_idx": i} for i, _ in enumerate(chunks)],
            )
            total_chunks += len(chunks)
        except Exception as e:
            errors.append({"url": url, "error": str(e)})

    await db.execute(
        update(KBCollection)
        .where(KBCollection.id == req.collection_id)
        .values(doc_count=KBCollection.doc_count + total_chunks)
    )
    await db.commit()

    return {
        "ingested_chunks": total_chunks,
        "urls_processed": len(req.urls) - len(errors),
        "errors": errors,
        "collection": kb.name,
    }


@router.post("/query")
async def query_kb(
    req: QueryRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Test a RAG query against a collection."""
    result = await db.execute(select(KBCollection).where(KBCollection.id == req.collection_id))
    kb = result.scalar_one_or_none()
    if not kb:
        raise HTTPException(status_code=404, detail="Collection not found")

    query_embedding = await embed_texts([req.query], model=kb.embed_model)

    chroma = get_chroma()
    collection = chroma.get_or_create_collection(kb.chroma_collection)
    results = collection.query(
        query_embeddings=query_embedding,
        n_results=req.top_k,
        include=["documents", "distances", "metadatas"],
    )

    return {
        "query": req.query,
        "results": [
            {
                "text": doc,
                "distance": dist,
                "source": meta.get("source"),
            }
            for doc, dist, meta in zip(
                results["documents"][0],
                results["distances"][0],
                results["metadatas"][0],
            )
        ],
    }
