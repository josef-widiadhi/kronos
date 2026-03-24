"""
Docker control router.
- List running containers
- Inject a baked KB+model into a container
  (copies chroma volume instead of re-pulling)
- Exec commands with approval
"""
import docker
import tarfile
import io
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
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


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/containers")
async def list_containers(_: str = Depends(get_current_owner)):
    """List all running Docker containers with basic metadata."""
    client = get_docker_client()
    containers = client.containers.list(all=True)
    return {
        "count": len(containers),
        "containers": [
            {
                "id": c.short_id,
                "name": c.name,
                "image": c.image.tags[0] if c.image.tags else c.image.short_id,
                "status": c.status,
                "ports": c.ports,
                "created": c.attrs.get("Created"),
                "labels": c.labels,
            }
            for c in containers
        ],
    }


@router.get("/containers/{container_id}/stats")
async def container_stats(container_id: str, _: str = Depends(get_current_owner)):
    """Get live CPU/mem stats for a container."""
    client = get_docker_client()
    try:
        c = client.containers.get(container_id)
        stats = c.stats(stream=False)
        # CPU %
        cpu_delta = stats["cpu_stats"]["cpu_usage"]["total_usage"] - \
                    stats["precpu_stats"]["cpu_usage"]["total_usage"]
        system_delta = stats["cpu_stats"]["system_cpu_usage"] - \
                       stats["precpu_stats"]["system_cpu_usage"]
        num_cpus = stats["cpu_stats"].get("online_cpus", 1)
        cpu_pct = (cpu_delta / system_delta) * num_cpus * 100.0 if system_delta > 0 else 0

        # Memory
        mem_usage = stats["memory_stats"].get("usage", 0)
        mem_limit = stats["memory_stats"].get("limit", 1)
        mem_pct = (mem_usage / mem_limit) * 100.0

        return {
            "container": container_id,
            "cpu_percent": round(cpu_pct, 2),
            "memory_usage_mb": round(mem_usage / 1e6, 1),
            "memory_limit_mb": round(mem_limit / 1e6, 1),
            "memory_percent": round(mem_pct, 2),
        }
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Container not found")


class InjectKBRequest(BaseModel):
    container_id: str
    kb_collection_id: str
    target_path: str = "/root/.chroma"  # Where inside the container to place the KB


@router.post("/inject-kb")
async def inject_kb_to_container(
    req: InjectKBRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """
    Queue approval to inject a baked ChromaDB KB into an existing container.
    This avoids re-pulling and re-learning — the KB is copied directly.
    """
    result = await db.execute(select(KBCollection).where(KBCollection.id == req.kb_collection_id))
    kb = result.scalar_one_or_none()
    if not kb:
        raise HTTPException(status_code=404, detail="KB Collection not found")

    approval = await create_approval_request(
        action_type="docker_inject_kb",
        payload={
            "container_id": req.container_id,
            "kb_collection_id": req.kb_collection_id,
            "kb_name": kb.name,
            "chroma_collection": kb.chroma_collection,
            "target_path": req.target_path,
        },
        db=db,
    )
    return {
        "message": "KB injection queued for owner approval",
        "approval_request_id": approval.id,
        "kb": kb.name,
        "target_container": req.container_id,
    }


@router.post("/inject-kb/execute/{approval_id}")
async def execute_inject_kb(
    approval_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """
    Execute an approved KB injection.
    Tars the local ChromaDB collection directory and streams it into the container.
    """
    from sqlalchemy import select as sa_select
    from core.database import ApprovalRequest

    result = await db.execute(
        sa_select(ApprovalRequest).where(
            ApprovalRequest.id == approval_id,
            ApprovalRequest.action_type == "docker_inject_kb",
            ApprovalRequest.status == "approved",
        )
    )
    approval = result.scalar_one_or_none()
    if not approval:
        raise HTTPException(status_code=404, detail="Approved injection request not found")

    payload = approval.payload
    chroma_local_path = os.path.join(
        settings.CHROMA_PERSIST_DIR, payload["chroma_collection"]
    )

    if not os.path.exists(chroma_local_path):
        raise HTTPException(
            status_code=404,
            detail=f"Local ChromaDB collection not found at {chroma_local_path}. "
                   "Make sure CHROMA_PERSIST_DIR is configured correctly."
        )

    # Create tar archive in memory
    tar_buffer = io.BytesIO()
    with tarfile.open(fileobj=tar_buffer, mode="w:gz") as tar:
        tar.add(chroma_local_path, arcname=payload["chroma_collection"])
    tar_buffer.seek(0)

    client = get_docker_client()
    try:
        container = client.containers.get(payload["container_id"])
        # Ensure target directory exists
        container.exec_run(f"mkdir -p {payload['target_path']}")
        # Copy tar into container
        container.put_archive(payload["target_path"], tar_buffer)
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Container not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Injection failed: {e}")

    return {
        "status": "injected",
        "container": payload["container_id"],
        "kb": payload["kb_name"],
        "target_path": payload["target_path"],
    }


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
