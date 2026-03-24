"""
Agent Factory router.
- CRUD for AI workers
- Manage system prompts
- Deploy agent as Docker container with baked KB
- Stop / restart agents
"""
import uuid
import json
import docker
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete

from core.config import settings
from core.database import get_db, Agent, KBCollection, AgentLog
from routers.auth import get_current_owner, create_approval_request

router = APIRouter()

AGENT_TYPES = ["url_crawler", "db_learner", "folder_watcher", "rag_validator", "custom"]

DEFAULT_PROMPTS = {
    "url_crawler": "You are a web knowledge specialist. Answer questions using the web content in your knowledge base. Always cite the source URL.",
    "db_learner": "You are a database knowledge specialist. Answer questions from structured data in your knowledge base. Be precise with numbers and facts.",
    "folder_watcher": "You are a document specialist. Answer questions from the documents in your knowledge base. Quote relevant sections when helpful.",
    "rag_validator": "You are a RAG quality validator. Evaluate the accuracy and completeness of RAG responses. Identify gaps and score confidence.",
    "custom": "You are a helpful AI assistant with access to a specialized knowledge base.",
}


# ── Schemas ───────────────────────────────────────────────────────────────────

class AgentCreate(BaseModel):
    name: str
    description: Optional[str] = None
    agent_type: str
    model: str
    kb_collection_id: Optional[str] = None
    system_prompt: Optional[str] = None
    config: Optional[dict] = None


class AgentUpdate(BaseModel):
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    config: Optional[dict] = None


class DeployRequest(BaseModel):
    agent_id: str
    port: Optional[int] = None                 # Host port to expose (auto-assigned if None)
    env_vars: Optional[dict] = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
async def list_agents(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(select(Agent).order_by(Agent.created_at.desc()))
    agents = result.scalars().all()
    return {"count": len(agents), "agents": agents}


@router.get("/{agent_id}")
async def get_agent(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.post("")
async def create_agent(
    req: AgentCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    if req.agent_type not in AGENT_TYPES:
        raise HTTPException(status_code=400, detail=f"agent_type must be one of {AGENT_TYPES}")

    # Validate KB collection if provided
    if req.kb_collection_id:
        kb_result = await db.execute(
            select(KBCollection).where(KBCollection.id == req.kb_collection_id)
        )
        if not kb_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="KB Collection not found")

    agent = Agent(
        name=req.name,
        description=req.description,
        agent_type=req.agent_type,
        model=req.model,
        kb_collection_id=req.kb_collection_id,
        system_prompt=req.system_prompt or DEFAULT_PROMPTS.get(req.agent_type, ""),
        config=req.config or {},
        status="staged",
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent


@router.patch("/{agent_id}")
async def update_agent(
    agent_id: str,
    req: AgentUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    values = {k: v for k, v in req.model_dump().items() if v is not None}
    if not values:
        raise HTTPException(status_code=400, detail="No fields to update")

    await db.execute(update(Agent).where(Agent.id == agent_id).values(**values))
    await db.commit()

    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    return result.scalar_one_or_none()


@router.delete("/{agent_id}")
async def delete_agent(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if agent.status == "running":
        raise HTTPException(status_code=400, detail="Stop the agent before deleting")

    await db.execute(delete(Agent).where(Agent.id == agent_id))
    await db.commit()
    return {"deleted": agent_id}


@router.post("/deploy")
async def deploy_agent(
    req: DeployRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """
    Queue an agent deployment for owner approval.
    The deployment will:
    1. Build a Docker image with the KB baked in
    2. Launch a container running the KRONOS worker process
    """
    result = await db.execute(select(Agent).where(Agent.id == req.agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    kb_info = None
    if agent.kb_collection_id:
        kb_result = await db.execute(
            select(KBCollection).where(KBCollection.id == agent.kb_collection_id)
        )
        kb = kb_result.scalar_one_or_none()
        if kb:
            kb_info = {"name": kb.name, "chroma_collection": kb.chroma_collection}

    approval = await create_approval_request(
        action_type="agent_deploy",
        payload={
            "agent_id": req.agent_id,
            "agent_name": agent.name,
            "agent_type": agent.agent_type,
            "model": agent.model,
            "kb_info": kb_info,
            "port": req.port,
            "env_vars": req.env_vars or {},
        },
        db=db,
    )
    return {
        "message": "Deploy request queued for owner approval",
        "approval_request_id": approval.id,
        "agent": agent.name,
    }


@router.post("/deploy/execute/{approval_id}")
async def execute_deploy(
    approval_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """
    Execute an approved deployment.
    Builds a Docker image with baked ChromaDB KB and launches the worker.
    """
    from sqlalchemy import select as sa_select
    from core.database import ApprovalRequest
    import os

    result = await db.execute(
        sa_select(ApprovalRequest).where(
            ApprovalRequest.id == approval_id,
            ApprovalRequest.action_type == "agent_deploy",
            ApprovalRequest.status == "approved",
        )
    )
    approval = result.scalar_one_or_none()
    if not approval:
        raise HTTPException(status_code=404, detail="Approved deploy request not found")

    payload = approval.payload
    agent_result = await db.execute(select(Agent).where(Agent.id == payload["agent_id"]))
    agent = agent_result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Build Dockerfile content for this worker
    kb_info = payload.get("kb_info")
    dockerfile = _build_worker_dockerfile(
        model=payload["model"],
        kb_info=kb_info,
        system_prompt=agent.system_prompt,
    )

    image_tag = f"kronos-worker-{agent.name.lower().replace(' ', '-')}:{uuid.uuid4().hex[:8]}"
    container_name = f"kronos_{agent.name.lower().replace(' ', '_')}"

    try:
        dclient = docker.from_env()
        # Build image (with KB volume mount)
        import tempfile, shutil
        build_dir = tempfile.mkdtemp()
        with open(os.path.join(build_dir, "Dockerfile"), "w") as f:
            f.write(dockerfile)

        # Copy KB data into build context if available
        if kb_info:
            chroma_src = os.path.join(settings.CHROMA_PERSIST_DIR, kb_info["chroma_collection"])
            if os.path.exists(chroma_src):
                shutil.copytree(chroma_src, os.path.join(build_dir, "chroma_kb"))

        image, build_logs = dclient.images.build(
            path=build_dir,
            tag=image_tag,
            rm=True,
        )

        env_vars = {
            "KRONOS_AGENT_ID": agent.id,
            "KRONOS_AGENT_NAME": agent.name,
            "KRONOS_MODEL": payload["model"],
            "OLLAMA_BASE_URL": settings.OLLAMA_BASE_URL,
            **(payload.get("env_vars") or {}),
        }

        port_bindings = {}
        if payload.get("port"):
            port_bindings = {"8080/tcp": payload["port"]}

        container = dclient.containers.run(
            image_tag,
            name=container_name,
            detach=True,
            environment=env_vars,
            ports=port_bindings,
            network=settings.KRONOS_WORKER_NETWORK,
            labels={
                "kronos.agent_id": agent.id,
                "kronos.agent_type": payload["agent_type"],
                "kronos.managed": "true",
            },
            restart_policy={"Name": "unless-stopped"},
        )

        shutil.rmtree(build_dir, ignore_errors=True)

        await db.execute(
            update(Agent)
            .where(Agent.id == agent.id)
            .values(
                status="running",
                container_id=container.id,
                container_name=container_name,
                image_tag=image_tag,
            )
        )
        await db.commit()

        return {
            "status": "deployed",
            "container_id": container.short_id,
            "container_name": container_name,
            "image": image_tag,
        }

    except docker.errors.BuildError as e:
        await db.execute(update(Agent).where(Agent.id == agent.id).values(status="error"))
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Docker build failed: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{agent_id}/stop")
async def stop_agent(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent or not agent.container_id:
        raise HTTPException(status_code=404, detail="Agent or container not found")

    try:
        dclient = docker.from_env()
        container = dclient.containers.get(agent.container_id)
        container.stop(timeout=10)
        await db.execute(update(Agent).where(Agent.id == agent_id).values(status="stopped"))
        await db.commit()
        return {"status": "stopped", "agent": agent.name}
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Container not found")


@router.get("/{agent_id}/logs")
async def agent_logs(
    agent_id: str,
    tail: int = 100,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Docker logs
    docker_logs = ""
    if agent.container_id:
        try:
            dclient = docker.from_env()
            container = dclient.containers.get(agent.container_id)
            docker_logs = container.logs(tail=tail, timestamps=True).decode("utf-8", errors="ignore")
        except Exception:
            docker_logs = "(container not found)"

    return {"agent": agent.name, "docker_logs": docker_logs}


# ── Internal helpers ──────────────────────────────────────────────────────────

def _build_worker_dockerfile(model: str, kb_info: Optional[dict], system_prompt: str) -> str:
    """Generate a Dockerfile for a KRONOS worker with baked KB."""
    copy_kb = ""
    if kb_info:
        copy_kb = f"COPY chroma_kb/ /root/.chroma/{kb_info['chroma_collection']}/"

    return f"""FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir fastapi uvicorn httpx chromadb

{copy_kb}

ENV KRONOS_MODEL={model}
ENV CHROMA_COLLECTION={kb_info['chroma_collection'] if kb_info else ''}

COPY worker.py .

EXPOSE 8080
CMD ["uvicorn", "worker:app", "--host", "0.0.0.0", "--port", "8080"]
"""
