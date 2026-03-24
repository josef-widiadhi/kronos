"""
KRONOS MCP Layer
================
Each deployed agent can be exposed as an MCP tool server.
This module provides:

1. MCPToolServer  — a FastAPI sub-app that speaks the MCP protocol
2. MCPRegistry    — tracks all active MCP-capable agents
3. Agent-to-agent calling — agents can call each other via MCP
4. Orchestrator   — a meta-agent that routes tasks to specialist workers

MCP Protocol (simplified tool-calling over HTTP SSE):
  GET  /mcp/sse          → SSE stream for tool discovery + results
  POST /mcp/messages     → send tool calls
  GET  /mcp/tools        → list available tools (JSON)
  POST /mcp/tools/{name} → invoke a specific tool
"""

import asyncio
import json
import uuid
from typing import Any, AsyncGenerator, Optional
from datetime import datetime

import httpx
import chromadb
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.config import settings
from core.database import get_db, Agent, KBCollection
from routers.auth import get_current_owner

router = APIRouter()


# ── MCP Tool Schemas ──────────────────────────────────────────────────────────

class MCPTool(BaseModel):
    name: str
    description: str
    inputSchema: dict


class MCPToolCall(BaseModel):
    tool_name: str
    arguments: dict
    call_id: Optional[str] = None


class MCPToolResult(BaseModel):
    call_id: str
    tool_name: str
    result: Any
    is_error: bool = False
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    timestamp: str = ""

    def __init__(self, **data):
        if not data.get("timestamp"):
            data["timestamp"] = datetime.utcnow().isoformat()
        super().__init__(**data)


# ── Tool Definitions per Agent Type ──────────────────────────────────────────

AGENT_TYPE_TOOLS = {
    "url_crawler": [
        MCPTool(
            name="query_web_knowledge",
            description="Query the agent's web-crawled knowledge base. Returns relevant passages from ingested web pages.",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The question or topic to search for"},
                    "top_k": {"type": "integer", "default": 5, "description": "Number of results to return"},
                },
                "required": ["query"],
            },
        ),
        MCPTool(
            name="chat_with_web_knowledge",
            description="Chat with the agent using its web-crawled knowledge base as context.",
            inputSchema={
                "type": "object",
                "properties": {
                    "message": {"type": "string", "description": "The message or question"},
                    "history": {"type": "array", "items": {"type": "object"}, "description": "Conversation history"},
                },
                "required": ["message"],
            },
        ),
    ],
    "db_learner": [
        MCPTool(
            name="query_database_knowledge",
            description="Query structured database knowledge. Returns relevant data passages and facts.",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The data query or question"},
                    "top_k": {"type": "integer", "default": 5},
                },
                "required": ["query"],
            },
        ),
        MCPTool(
            name="get_data_summary",
            description="Get a summary or analysis of data from the database knowledge base.",
            inputSchema={
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "The data topic to summarize"},
                },
                "required": ["topic"],
            },
        ),
    ],
    "folder_watcher": [
        MCPTool(
            name="query_documents",
            description="Search through ingested documents (PDFs, Word files, etc.) for relevant information.",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "What to search for in the documents"},
                    "top_k": {"type": "integer", "default": 5},
                },
                "required": ["query"],
            },
        ),
        MCPTool(
            name="extract_from_documents",
            description="Extract specific information or facts from the document knowledge base.",
            inputSchema={
                "type": "object",
                "properties": {
                    "extraction_request": {"type": "string", "description": "What specific information to extract"},
                },
                "required": ["extraction_request"],
            },
        ),
    ],
    "rag_validator": [
        MCPTool(
            name="validate_rag_response",
            description="Validate the quality and accuracy of a RAG-generated response against source material.",
            inputSchema={
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "The original question asked"},
                    "answer": {"type": "string", "description": "The RAG-generated answer to validate"},
                    "context": {"type": "string", "description": "The context/sources used to generate the answer"},
                },
                "required": ["question", "answer"],
            },
        ),
        MCPTool(
            name="score_relevance",
            description="Score how relevant a set of retrieved passages is to a given query (0-1).",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "passages": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["query", "passages"],
            },
        ),
    ],
    "custom": [
        MCPTool(
            name="query_knowledge",
            description="Query this agent's specialized knowledge base.",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Your question or search query"},
                    "top_k": {"type": "integer", "default": 5},
                },
                "required": ["query"],
            },
        ),
        MCPTool(
            name="chat",
            description="Chat with this specialized AI agent.",
            inputSchema={
                "type": "object",
                "properties": {
                    "message": {"type": "string"},
                    "history": {"type": "array", "items": {"type": "object"}},
                },
                "required": ["message"],
            },
        ),
    ],
}

# Universal tool available on ALL agent types
UNIVERSAL_TOOL = MCPTool(
    name="get_agent_info",
    description="Get metadata about this agent: its type, model, KB collection, and capabilities.",
    inputSchema={
        "type": "object",
        "properties": {},
    },
)


# ── MCP Tool Executor ─────────────────────────────────────────────────────────

class MCPExecutor:
    """Executes MCP tool calls for a specific agent."""

    def __init__(self, agent: Agent, kb: Optional[KBCollection] = None):
        self.agent = agent
        self.kb = kb

    async def execute(self, tool_name: str, arguments: dict) -> Any:
        if tool_name == "get_agent_info":
            return self._agent_info()

        # Route to deployed container if running
        if self.agent.status == "running" and self.agent.container_name:
            return await self._forward_to_container(tool_name, arguments)

        # Fallback: execute locally
        return await self._execute_locally(tool_name, arguments)

    def _agent_info(self) -> dict:
        return {
            "id": self.agent.id,
            "name": self.agent.name,
            "type": self.agent.agent_type,
            "model": self.agent.model,
            "status": self.agent.status,
            "kb_collection": self.kb.name if self.kb else None,
            "kb_chunks": self.kb.doc_count if self.kb else 0,
            "system_prompt_preview": (self.agent.system_prompt or "")[:120],
            "tools": [t.name for t in AGENT_TYPE_TOOLS.get(self.agent.agent_type, [])],
        }

    async def _forward_to_container(self, tool_name: str, arguments: dict) -> Any:
        """Forward tool call to the running container's /chat or /query endpoint."""
        base_url = f"http://{self.agent.container_name}:8080"
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                # Map tool names to container endpoints
                if tool_name in ("chat", "chat_with_web_knowledge"):
                    r = await client.post(f"{base_url}/chat", json={
                        "message": arguments.get("message", arguments.get("query", "")),
                        "history": arguments.get("history", []),
                    })
                    return r.json()
                elif "query" in tool_name or "extract" in tool_name:
                    r = await client.post(f"{base_url}/chat", json={
                        "message": arguments.get("query", arguments.get("extraction_request", "")),
                        "top_k": arguments.get("top_k", 5),
                    })
                    return r.json()
                elif tool_name == "validate_rag_response":
                    prompt = f"Validate this RAG answer:\nQuestion: {arguments['question']}\nAnswer: {arguments['answer']}\nContext: {arguments.get('context', 'N/A')}"
                    r = await client.post(f"{base_url}/chat", json={"message": prompt})
                    return r.json()
                elif tool_name == "score_relevance":
                    prompt = f"Score relevance (0-1) of these passages to the query '{arguments['query']}':\n" + "\n---\n".join(arguments.get("passages", []))
                    r = await client.post(f"{base_url}/chat", json={"message": prompt})
                    return r.json()
                else:
                    raise ValueError(f"Unknown tool: {tool_name}")
        except httpx.ConnectError:
            raise HTTPException(status_code=503, detail=f"Agent container {self.agent.container_name} unreachable")

    async def _execute_locally(self, tool_name: str, arguments: dict) -> Any:
        """Execute directly via Ollama + ChromaDB without a deployed container."""
        if not self.kb:
            return {"error": "No KB collection attached to this agent"}

        query = arguments.get("query") or arguments.get("message") or arguments.get("topic") or arguments.get("extraction_request") or ""
        if not query:
            return {"error": "No query provided"}

        # RAG retrieval
        context = ""
        sources = []
        try:
            chroma = chromadb.HttpClient(host=settings.CHROMA_HOST, port=settings.CHROMA_PORT, tenant=chromadb.DEFAULT_TENANT, database=chromadb.DEFAULT_DATABASE)
            collection = chroma.get_or_create_collection(self.kb.chroma_collection)

            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(
                    f"{settings.OLLAMA_BASE_URL}/api/embeddings",
                    json={"model": self.kb.embed_model, "prompt": query},
                )
                embedding = r.json()["embedding"]

            results = collection.query(
                query_embeddings=[embedding],
                n_results=arguments.get("top_k", 5),
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
            return {"error": f"KB retrieval failed: {e}"}

        # Ollama chat
        system = self.agent.system_prompt or "You are a helpful assistant."
        if context:
            system += f"\n\nRelevant context:\n{context}"

        history = arguments.get("history", [])
        messages = [{"role": "system", "content": system}] + history
        messages.append({"role": "user", "content": query})

        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/chat",
                json={"model": self.agent.model, "messages": messages, "stream": False},
            )
            resp = r.json()

        return {
            "reply": resp["message"]["content"],
            "model": self.agent.model,
            "sources": sources,
            "rag_used": bool(context),
        }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/agents")
async def list_mcp_agents(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """List all agents that can be used as MCP tool servers."""
    result = await db.execute(select(Agent).order_by(Agent.created_at.desc()))
    agents = result.scalars().all()
    return {
        "agents": [
            {
                "id": a.id,
                "name": a.name,
                "type": a.agent_type,
                "model": a.model,
                "status": a.status,
                "mcp_endpoint": f"/api/mcp/agents/{a.id}",
                "tools": [t.name for t in AGENT_TYPE_TOOLS.get(a.agent_type, []) + [UNIVERSAL_TOOL]],
            }
            for a in agents
        ]
    }


@router.get("/agents/{agent_id}/tools")
async def list_agent_tools(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """List MCP tools available for a specific agent."""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    tools = AGENT_TYPE_TOOLS.get(agent.agent_type, []) + [UNIVERSAL_TOOL]
    return {
        "agent_id": agent_id,
        "agent_name": agent.name,
        "tools": [t.model_dump() for t in tools],
    }


@router.post("/agents/{agent_id}/call")
async def call_agent_tool(
    agent_id: str,
    call: MCPToolCall,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """Invoke an MCP tool on a specific agent."""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Load KB
    kb = None
    if agent.kb_collection_id:
        kb_result = await db.execute(select(KBCollection).where(KBCollection.id == agent.kb_collection_id))
        kb = kb_result.scalar_one_or_none()

    # Validate tool exists
    valid_tools = {t.name for t in AGENT_TYPE_TOOLS.get(agent.agent_type, []) + [UNIVERSAL_TOOL]}
    if call.tool_name not in valid_tools:
        raise HTTPException(status_code=400, detail=f"Tool '{call.tool_name}' not available on agent type '{agent.agent_type}'")

    call_id = call.call_id or str(uuid.uuid4())
    executor = MCPExecutor(agent=agent, kb=kb)

    try:
        result_data = await executor.execute(call.tool_name, call.arguments)
        return MCPToolResult(
            call_id=call_id,
            tool_name=call.tool_name,
            result=result_data,
            agent_id=agent.id,
            agent_name=agent.name,
        )
    except Exception as e:
        return MCPToolResult(
            call_id=call_id,
            tool_name=call.tool_name,
            result={"error": str(e)},
            is_error=True,
            agent_id=agent.id,
            agent_name=agent.name,
        )


@router.get("/agents/{agent_id}/sse")
async def agent_sse_stream(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    SSE endpoint for MCP protocol compliance.
    Streams tool discovery and real-time events for this agent.
    """
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    tools = AGENT_TYPE_TOOLS.get(agent.agent_type, []) + [UNIVERSAL_TOOL]

    async def event_stream() -> AsyncGenerator[str, None]:
        # Send tool manifest
        manifest = {
            "type": "tool_manifest",
            "agent_id": agent_id,
            "agent_name": agent.name,
            "agent_type": agent.agent_type,
            "model": agent.model,
            "status": agent.status,
            "tools": [t.model_dump() for t in tools],
        }
        yield f"data: {json.dumps(manifest)}\n\n"

        # Heartbeat every 15s
        while True:
            await asyncio.sleep(15)
            heartbeat = {
                "type": "heartbeat",
                "agent_id": agent_id,
                "status": agent.status,
                "timestamp": datetime.utcnow().isoformat(),
            }
            yield f"data: {json.dumps(heartbeat)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Orchestrator ──────────────────────────────────────────────────────────────

class OrchestrationRequest(BaseModel):
    task: str
    agent_ids: Optional[list] = None   # specific agents, or None = all running
    strategy: str = "parallel"          # parallel | sequential | best_of


@router.post("/orchestrate")
async def orchestrate(
    req: OrchestrationRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_owner),
):
    """
    Orchestrate a task across multiple agents.
    - parallel:   call all agents simultaneously, merge results
    - sequential: chain agents, passing context forward
    - best_of:    call all, pick highest-confidence answer
    """
    # Get target agents
    if req.agent_ids:
        result = await db.execute(select(Agent).where(Agent.id.in_(req.agent_ids)))
    else:
        result = await db.execute(select(Agent).where(Agent.status == "running"))
    agents = result.scalars().all()

    if not agents:
        raise HTTPException(status_code=404, detail="No target agents found")

    # Load KBs
    kb_map = {}
    for agent in agents:
        if agent.kb_collection_id:
            kb_result = await db.execute(select(KBCollection).where(KBCollection.id == agent.kb_collection_id))
            kb_map[agent.id] = kb_result.scalar_one_or_none()

    executors = {a.id: MCPExecutor(agent=a, kb=kb_map.get(a.id)) for a in agents}

    if req.strategy == "parallel":
        tasks = [
            executors[a.id].execute("chat" if "chat" in [t.name for t in AGENT_TYPE_TOOLS.get(a.agent_type, [])] else "query_knowledge", {"message": req.task, "query": req.task})
            for a in agents
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return {
            "strategy": "parallel",
            "task": req.task,
            "responses": [
                {
                    "agent_id": a.id,
                    "agent_name": a.name,
                    "agent_type": a.agent_type,
                    "result": r if not isinstance(r, Exception) else {"error": str(r)},
                    "error": isinstance(r, Exception),
                }
                for a, r in zip(agents, results)
            ],
        }

    elif req.strategy == "sequential":
        context = ""
        responses = []
        for agent in agents:
            executor = executors[agent.id]
            task_with_context = req.task if not context else f"{req.task}\n\nPrevious agent context:\n{context}"
            try:
                r = await executor.execute(
                    "chat" if "chat" in [t.name for t in AGENT_TYPE_TOOLS.get(agent.agent_type, [])] else "query_knowledge",
                    {"message": task_with_context, "query": task_with_context}
                )
                reply = r.get("reply", str(r))
                context += f"\n[{agent.name}]: {reply}"
                responses.append({"agent_id": agent.id, "agent_name": agent.name, "result": r})
            except Exception as e:
                responses.append({"agent_id": agent.id, "agent_name": agent.name, "error": str(e)})
        return {"strategy": "sequential", "task": req.task, "responses": responses, "final_context": context}

    elif req.strategy == "best_of":
        tasks = [
            executors[a.id].execute("query_knowledge", {"query": req.task})
            for a in agents
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Pick result with highest average source relevance
        best = None
        best_score = -1
        for agent, r in zip(agents, results):
            if isinstance(r, Exception):
                continue
            sources = r.get("sources", [])
            score = sum(s.get("relevance", 0) for s in sources) / max(len(sources), 1)
            if score > best_score:
                best_score = score
                best = {"agent_id": agent.id, "agent_name": agent.name, "result": r, "score": score}

        return {
            "strategy": "best_of",
            "task": req.task,
            "winner": best,
            "all_scores": [
                {
                    "agent_id": a.id,
                    "agent_name": a.name,
                    "score": sum(r.get("sources", [{}])[0].get("relevance", 0) for r in [results[i]] if not isinstance(results[i], Exception)) / 1
                    if not isinstance(results[i], Exception) else 0,
                }
                for i, a in enumerate(agents)
            ],
        }

    raise HTTPException(status_code=400, detail=f"Unknown strategy: {req.strategy}")
