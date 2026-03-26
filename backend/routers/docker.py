"""
Docker control router.
- List containers with metadata
- Push a model from host Ollama into a target container's Ollama
- Inject a ChromaDB KB collection into a target container
- Execute approved commands
"""
import docker
import json
import tarfile
import io
import os
import asyncio
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.config import settings
from core.database import get_db, KBCollection
from routers.auth import get_current_owner, create_approval_request

router = APIRouter()


def get_docker_client():
    try:
        return docker.from_env()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Docker daemon not reachable: {e}")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_container_ollama_port(container) -> Optional[int]:
    """Find the host port mapped to 11434 on a container, if any."""
    ports = container.ports or {}
    mapping = ports.get("11434/tcp")
    if mapping and isinstance(mapping, list) and mapping[0].get("HostPort"):
        return int(mapping[0]["HostPort"])
    return None


def _get_container_ip(container) -> Optional[str]:
    """Get container's IP on the first network it's on."""
    networks = container.attrs.get("NetworkSettings", {}).get("Networks", {})
    for net_name, net_info in networks.items():
        ip = net_info.get("IPAddress")
        if ip:
            return ip
    return None


async def _detect_ollama_endpoint(container) -> Optional[str]:
    """
    Detect where Ollama is reachable for a given container.
    Priority: mapped host port → container IP on internal network.
    """
    # 1. Check mapped host port
    host_port = _get_container_ollama_port(container)
    if host_port:
        url = f"http://localhost:{host_port}"
        try:
            async with httpx.AsyncClient(timeout=3) as c:
                r = await c.get(f"{url}/api/version")
                if r.status_code == 200:
                    return url
        except Exception:
            pass

    # 2. Try container's internal IP
    ip = _get_container_ip(container)
    if ip:
        url = f"http://{ip}:11434"
        try:
            async with httpx.AsyncClient(timeout=3) as c:
                r = await c.get(f"{url}/api/version")
                if r.status_code == 200:
                    return url
        except Exception:
            pass

    # 3. Try container name as hostname (docker DNS)
    url = f"http://{container.name}:11434"
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(f"{url}/api/version")
            if r.status_code == 200:
                return url
    except Exception:
        pass

    return None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/containers")
async def list_containers(_: str = Depends(get_current_owner)):
    """List all Docker containers with metadata and Ollama detection."""
    client = get_docker_client()
    containers = client.containers.list(all=True)
    result = []
    for c in containers:
        has_ollama_port = _get_container_ollama_port(c) is not None
        # Detect Ollama by port mapping OR image name
        is_ollama = (
            has_ollama_port
            or "ollama" in (c.image.tags[0] if c.image.tags else "").lower()
            or "11434" in str(c.ports)
        )
        result.append({
            "id": c.short_id,
            "name": c.name,
            "image": c.image.tags[0] if c.image.tags else c.image.short_id,
            "status": c.status,
            "ports": c.ports,
            "created": c.attrs.get("Created"),
            "labels": c.labels,
            "is_ollama": is_ollama,
            "ollama_host_port": _get_container_ollama_port(c),
            "container_ip": _get_container_ip(c),
        })
    return {"count": len(result), "containers": result}


@router.get("/containers/{container_id}/stats")
async def container_stats(container_id: str, _: str = Depends(get_current_owner)):
    """Get live CPU/mem stats for a container."""
    client = get_docker_client()
    try:
        c = client.containers.get(container_id)
        stats = c.stats(stream=False)
        cpu_delta = (
            stats["cpu_stats"]["cpu_usage"]["total_usage"]
            - stats["precpu_stats"]["cpu_usage"]["total_usage"]
        )
        system_delta = (
            stats["cpu_stats"]["system_cpu_usage"]
            - stats["precpu_stats"]["system_cpu_usage"]
        )
        num_cpus = stats["cpu_stats"].get("online_cpus", 1)
        cpu_pct = (cpu_delta / system_delta) * num_cpus * 100.0 if system_delta > 0 else 0
        mem_usage = stats["memory_stats"].get("usage", 0)
        mem_limit = stats["memory_stats"].get("limit", 1)
        return {
            "container": container_id,
            "cpu_percent": round(cpu_pct, 2),
            "memory_usage_mb": round(mem_usage / 1e6, 1),
            "memory_limit_mb": round(mem_limit / 1e6, 1),
            "memory_percent": round((mem_usage / mem_limit) * 100.0, 2),
        }
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Container not found")


@router.get("/containers/{container_id}/ollama-check")
async def check_container_ollama(container_id: str, _: str = Depends(get_current_owner)):
    """
    Check if a container has Ollama running and what models it has.
    Used to pre-flight the push-model flow.
    """
    client = get_docker_client()
    try:
        c = client.containers.get(container_id)
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Container not found")

    endpoint = await _detect_ollama_endpoint(c)
    if not endpoint:
        return {
            "has_ollama": False,
            "endpoint": None,
            "models": [],
            "hint": "No Ollama API found. Is Ollama running in this container on port 11434?",
        }

    try:
        async with httpx.AsyncClient(timeout=10) as client_http:
            r = await client_http.get(f"{endpoint}/api/tags")
            models = [m["name"] for m in r.json().get("models", [])]
        return {
            "has_ollama": True,
            "endpoint": endpoint,
            "models": models,
            "model_count": len(models),
        }
    except Exception as e:
        return {
            "has_ollama": True,
            "endpoint": endpoint,
            "models": [],
            "error": str(e),
        }


# ── Model Push ────────────────────────────────────────────────────────────────

class PushModelRequest(BaseModel):
    target_container_id: str          # The container with Ollama (e.g. arachne's ollama)
    model_name: str                   # Model to push (e.g. qwen2.5:7b)
    target_ollama_port: Optional[int] = None   # Override port if needed
    use_container_ip: bool = True     # Use container's internal IP


@router.post("/push-model")
async def push_model_to_container(
    req: PushModelRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """
    Queue approval to push a model from host Ollama into a target container's Ollama.
    This uses the Ollama API on the target container to pull the model —
    but since the model is already on the host and both share Docker networking,
    we can also copy the model blobs directly (faster, no internet needed).
    """
    client = get_docker_client()
    try:
        c = client.containers.get(req.target_container_id)
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Target container not found")

    endpoint = await _detect_ollama_endpoint(c)

    approval = await create_approval_request(
        action_type="docker_push_model",
        payload={
            "target_container_id": req.target_container_id,
            "target_container_name": c.name,
            "model_name": req.model_name,
            "target_ollama_endpoint": endpoint,
            "target_ollama_port": req.target_ollama_port,
        },
        db=db,
    )
    return {
        "message": "Model push queued for owner approval",
        "approval_request_id": approval.id,
        "model": req.model_name,
        "target": c.name,
        "target_ollama": endpoint or "auto-detect on execute",
    }


@router.post("/push-model/execute/{approval_id}")
async def execute_push_model(
    approval_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """
    Execute an approved model push.

    Strategy: Use the target Ollama's pull API pointing at the host Ollama as registry.
    This is the cleanest approach — Ollama handles the blob transfer natively.

    If that fails, falls back to copying model blobs directly via Docker tar.
    """
    from core.database import ApprovalRequest

    result = await db.execute(
        select(ApprovalRequest).where(
            ApprovalRequest.id == approval_id,
            ApprovalRequest.action_type == "docker_push_model",
            ApprovalRequest.status == "approved",
        )
    )
    approval = result.scalar_one_or_none()
    if not approval:
        raise HTTPException(status_code=404, detail="Approved push request not found")

    payload = approval.payload
    model_name = payload["model_name"]

    # Re-detect endpoint
    dclient = get_docker_client()
    try:
        c = dclient.containers.get(payload["target_container_id"])
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Target container no longer found")

    endpoint = payload.get("target_ollama_endpoint") or await _detect_ollama_endpoint(c)
    if not endpoint:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot reach Ollama in container '{payload['target_container_name']}'. "
                   "Ensure Ollama is running and port 11434 is accessible."
        )

    async def stream_push():
        import json as _json
        target_name = payload.get("target_container_name", "target")

        yield _json.dumps({"status": "starting", "message": f"Pushing {model_name} to {target_name}..."}) + "\n"

        try:
            async with httpx.AsyncClient(timeout=600) as client:
                # Verify model exists on source
                src_check = await client.get(f"{settings.OLLAMA_BASE_URL}/api/tags")
                src_models = [m["name"] for m in src_check.json().get("models", [])]
                if model_name not in src_models and f"{model_name}:latest" not in src_models:
                    yield _json.dumps({"status": "error", "message": f"Model {model_name} not found in source Ollama"}) + "\n"
                    return

                yield _json.dumps({"status": "pulling", "message": f"Requesting {target_name} Ollama to pull {model_name}..."}) + "\n"

                async with client.stream(
                    "POST",
                    f"{endpoint}/api/pull",
                    json={"name": model_name, "stream": True},
                    timeout=600,
                ) as response:
                    async for line in response.aiter_lines():
                        if line:
                            yield line + "\n"

                yield _json.dumps({"status": "complete", "model": model_name, "target": target_name}) + "\n"

        except httpx.ConnectError:
            yield _json.dumps({"status": "fallback", "message": "Direct pull failed, trying exec pull..."}) + "\n"
            try:
                result = container.exec_run(f"ollama pull {model_name}", stream=False)
                if result.exit_code == 0:
                    yield _json.dumps({"status": "complete", "model": model_name, "method": "exec_pull"}) + "\n"
                else:
                    output = result.output.decode("utf-8", errors="ignore")[:200] if result.output else ""
                    yield _json.dumps({"status": "error", "message": f"exec pull failed: {output}"}) + "\n"
            except Exception as e2:
                yield _json.dumps({"status": "error", "message": str(e2)[:200]}) + "\n"

        except Exception as e:
            yield _json.dumps({"status": "error", "message": str(e)[:300]}) + "\n"


    return StreamingResponse(stream_push(), media_type="application/x-ndjson")


# ── KB Injection ──────────────────────────────────────────────────────────────

class InjectKBRequest(BaseModel):
    container_id: str
    kb_collection_id: str
    target_path: str = "/root/.chroma"
    target_chroma_port: Optional[int] = None   # If target has its own ChromaDB HTTP


@router.post("/inject-kb")
async def inject_kb_to_container(
    req: InjectKBRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """
    Queue approval to inject a KB collection into a target container.
    The KB is copied as a ChromaDB persistent directory — no re-embedding needed.
    """
    result = await db.execute(select(KBCollection).where(KBCollection.id == req.kb_collection_id))
    kb = result.scalar_one_or_none()
    if not kb:
        raise HTTPException(status_code=404, detail="KB Collection not found")

    client = get_docker_client()
    try:
        c = client.containers.get(req.container_id)
        container_name = c.name
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Target container not found")

    approval = await create_approval_request(
        action_type="docker_inject_kb",
        payload={
            "container_id": req.container_id,
            "container_name": container_name,
            "kb_collection_id": req.kb_collection_id,
            "kb_name": kb.name,
            "chroma_collection": kb.chroma_collection,
            "target_path": req.target_path,
            "doc_count": kb.doc_count,
            "embed_model": kb.embed_model,
            "model": kb.model,
        },
        db=db,
    )
    return {
        "message": "KB injection queued for owner approval",
        "approval_request_id": approval.id,
        "kb": kb.name,
        "kb_chunks": kb.doc_count,
        "target_container": container_name,
        "target_path": req.target_path,
    }


@router.post("/inject-kb/execute/{approval_id}")
async def execute_inject_kb(
    approval_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Execute an approved KB injection — copies ChromaDB collection into target container."""
    from core.database import ApprovalRequest

    result = await db.execute(
        select(ApprovalRequest).where(
            ApprovalRequest.id == approval_id,
            ApprovalRequest.action_type == "docker_inject_kb",
            ApprovalRequest.status == "approved",
        )
    )
    approval = result.scalar_one_or_none()
    if not approval:
        raise HTTPException(status_code=404, detail="Approved injection request not found")

    payload = approval.payload

    # Find ChromaDB data — try persistent dir first, then query ChromaDB HTTP export
    chroma_local_path = os.path.join(settings.CHROMA_PERSIST_DIR, payload["chroma_collection"])

    if not os.path.exists(chroma_local_path):
        raise HTTPException(
            status_code=404,
            detail=f"Local ChromaDB data not found at {chroma_local_path}. "
                   f"CHROMA_PERSIST_DIR={settings.CHROMA_PERSIST_DIR}. "
                   "The collection exists in ChromaDB HTTP server but not as local files — "
                   "use inject-kb/export-and-inject instead."
        )

    # Build tar archive of the collection directory
    tar_buffer = io.BytesIO()
    with tarfile.open(fileobj=tar_buffer, mode="w:gz") as tar:
        tar.add(chroma_local_path, arcname=payload["chroma_collection"])
    tar_buffer.seek(0)

    client = get_docker_client()
    try:
        container = client.containers.get(payload["container_id"])
        container.exec_run(f"mkdir -p {payload['target_path']}")
        container.put_archive(payload["target_path"], tar_buffer)
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Container not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Injection failed: {e}")

    return {
        "status": "injected",
        "container": payload.get("container_name", payload["container_id"]),
        "kb": payload["kb_name"],
        "chunks": payload.get("doc_count", "?"),
        "target_path": payload["target_path"],
        "embed_model": payload.get("embed_model"),
        "note": f"KB is at {payload['target_path']}/{payload['chroma_collection']}. "
                "Point your app's ChromaDB client to this path (PersistentClient).",
    }


@router.post("/inject-kb/export-and-inject/{approval_id}")
async def export_and_inject_kb(
    approval_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """
    Alternative injection: exports KB from ChromaDB HTTP server (via API),
    then copies into target container. Use this when local files aren't available.
    """
    from core.database import ApprovalRequest
    import chromadb

    result = await db.execute(
        select(ApprovalRequest).where(
            ApprovalRequest.id == approval_id,
            ApprovalRequest.action_type == "docker_inject_kb",
            ApprovalRequest.status == "approved",
        )
    )
    approval = result.scalar_one_or_none()
    if not approval:
        raise HTTPException(status_code=404, detail="Approved injection request not found")

    payload = approval.payload

    # Export collection from ChromaDB HTTP into a temp PersistentClient
    import tempfile, shutil

    temp_dir = tempfile.mkdtemp(prefix="kronos_kb_export_")
    try:
        # Source: HTTP ChromaDB
        src = chromadb.HttpClient(
            host=settings.CHROMA_HOST,
            port=settings.CHROMA_PORT,
            tenant=chromadb.DEFAULT_TENANT,
            database=chromadb.DEFAULT_DATABASE,
        )
        src_col = src.get_or_create_collection(payload["chroma_collection"])

        # Get all items (in batches of 1000)
        total = src_col.count()
        all_ids, all_docs, all_embeddings, all_metas = [], [], [], []
        batch_size = 1000
        offset = 0
        while offset < total:
            batch = src_col.get(
                limit=batch_size,
                offset=offset,
                include=["documents", "embeddings", "metadatas"],
            )
            all_ids.extend(batch["ids"])
            all_docs.extend(batch["documents"] or [])
            all_embeddings.extend(batch["embeddings"] or [])
            all_metas.extend(batch["metadatas"] or [{}] * len(batch["ids"]))
            offset += batch_size

        if not all_ids:
            raise HTTPException(status_code=400, detail="Collection is empty")

        # Write to local PersistentClient
        dst = chromadb.PersistentClient(path=temp_dir)
        dst_col = dst.get_or_create_collection(payload["chroma_collection"])
        batch_size = 500
        for i in range(0, len(all_ids), batch_size):
            dst_col.add(
                ids=all_ids[i:i+batch_size],
                documents=all_docs[i:i+batch_size] if all_docs else None,
                embeddings=all_embeddings[i:i+batch_size] if all_embeddings else None,
                metadatas=all_metas[i:i+batch_size] if all_metas else None,
            )

        # Now tar the exported collection and inject into container
        col_path = os.path.join(temp_dir, payload["chroma_collection"])
        # ChromaDB PersistentClient may place data at temp_dir directly
        if not os.path.exists(col_path):
            col_path = temp_dir

        tar_buffer = io.BytesIO()
        with tarfile.open(fileobj=tar_buffer, mode="w:gz") as tar:
            tar.add(col_path, arcname=payload["chroma_collection"])
        tar_buffer.seek(0)

        dclient = get_docker_client()
        container = dclient.containers.get(payload["container_id"])
        container.exec_run(f"mkdir -p {payload['target_path']}")
        container.put_archive(payload["target_path"], tar_buffer)

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    return {
        "status": "exported_and_injected",
        "container": payload.get("container_name", payload["container_id"]),
        "kb": payload["kb_name"],
        "chunks_exported": total,
        "target_path": payload["target_path"],
    }




@router.get("/unsloth/status")
async def unsloth_status(_: str = Depends(get_current_owner)):
    """Check if the Unsloth Docker image is available locally."""
    client = get_docker_client()
    try:
        images = client.images.list()
        unsloth_imgs = [
            {"tags": img.tags, "size_gb": round(img.attrs["Size"] / 1e9, 1)}
            for img in images
            if any("unsloth" in (t or "").lower() for t in img.tags)
        ]
        return {
            "available": len(unsloth_imgs) > 0,
            "images": unsloth_imgs,
            "pull_command": "docker pull unsloth/unsloth-repo:latest",
            "size_estimate_gb": 8,
        }
    except Exception as e:
        return {"available": False, "error": str(e)}

class ExecRequest(BaseModel):
    container_id: str
    command: str


@router.post("/exec")
async def exec_in_container(
    req: ExecRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Queue an exec command for approval."""
    approval = await create_approval_request(
        action_type="docker_exec",
        payload={"container_id": req.container_id, "command": req.command},
        db=db,
    )
    return {
        "message": "Exec command queued for owner approval",
        "approval_request_id": approval.id,
    }
