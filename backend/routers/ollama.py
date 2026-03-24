"""
Ollama management router.
- Check if Ollama is installed / reachable
- Get version
- List pulled models
- Pull a new model (owner-approved)
- Delete a model (owner-approved)
"""
import httpx
import subprocess
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.database import get_db
from routers.auth import get_current_owner, create_approval_request

router = APIRouter()

OLLAMA_URL = settings.OLLAMA_BASE_URL


# ── Helpers ───────────────────────────────────────────────────────────────────

async def ollama_get(path: str):
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{OLLAMA_URL}{path}")
        r.raise_for_status()
        return r.json()


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/status")
async def ollama_status():
    """Check if Ollama is installed and API is reachable."""
    # 1. binary check
    try:
        result = subprocess.run(["ollama", "--version"], capture_output=True, text=True, timeout=5)
        binary_installed = result.returncode == 0
        binary_version = result.stdout.strip() if binary_installed else None
    except (FileNotFoundError, subprocess.TimeoutExpired):
        binary_installed = False
        binary_version = None

    # 2. API reachability
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{OLLAMA_URL}/api/version")
            api_reachable = r.status_code == 200
            api_version = r.json().get("version") if api_reachable else None
    except Exception:
        api_reachable = False
        api_version = None

    return {
        "binary_installed": binary_installed,
        "binary_version": binary_version,
        "api_reachable": api_reachable,
        "api_version": api_version,
        "ollama_url": OLLAMA_URL,
    }


@router.get("/models")
async def list_models(_: str = Depends(get_current_owner)):
    """Return all locally available (pulled) Ollama models."""
    try:
        data = await ollama_get("/api/tags")
        models = data.get("models", [])
        return {
            "count": len(models),
            "models": [
                {
                    "name": m["name"],
                    "size_gb": round(m.get("size", 0) / 1e9, 2),
                    "modified_at": m.get("modified_at"),
                    "digest": m.get("digest", "")[:12],
                    "details": m.get("details", {}),
                }
                for m in models
            ],
        }
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"Ollama API error: {e}")


@router.get("/models/{model_name}/info")
async def model_info(model_name: str, _: str = Depends(get_current_owner)):
    """Get detailed info for a specific model."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{OLLAMA_URL}/api/show",
                json={"name": model_name}
            )
            r.raise_for_status()
            return r.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=str(e))


class PullRequest(BaseModel):
    model_name: str


@router.post("/models/pull")
async def pull_model(
    req: PullRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """
    Request approval to pull a new Ollama model.
    Returns an approval_request_id — owner must approve before pull executes.
    """
    approval = await create_approval_request(
        action_type="ollama_pull",
        payload={"model_name": req.model_name},
        db=db,
    )
    return {
        "message": "Pull request queued for owner approval",
        "approval_request_id": approval.id,
        "model": req.model_name,
    }


@router.post("/models/pull/execute/{approval_id}")
async def execute_pull(
    approval_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Execute an approved pull request (streaming response)."""
    from sqlalchemy import select
    from core.database import ApprovalRequest
    from fastapi.responses import StreamingResponse
    import json

    result = await db.execute(
        select(ApprovalRequest).where(
            ApprovalRequest.id == approval_id,
            ApprovalRequest.action_type == "ollama_pull",
            ApprovalRequest.status == "approved",
        )
    )
    approval = result.scalar_one_or_none()
    if not approval:
        raise HTTPException(status_code=404, detail="Approved pull request not found")

    model_name = approval.payload["model_name"]

    async def stream_pull():
        async with httpx.AsyncClient(timeout=600) as client:
            async with client.stream(
                "POST",
                f"{OLLAMA_URL}/api/pull",
                json={"name": model_name, "stream": True},
            ) as response:
                async for line in response.aiter_lines():
                    if line:
                        yield line + "\n"

    return StreamingResponse(stream_pull(), media_type="application/x-ndjson")


@router.delete("/models/{model_name}")
async def delete_model(
    model_name: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Queue a model deletion for owner approval."""
    approval = await create_approval_request(
        action_type="ollama_delete",
        payload={"model_name": model_name},
        db=db,
    )
    return {
        "message": "Delete request queued for owner approval",
        "approval_request_id": approval.id,
    }
