"""
KRONOS MCP Worker
=================
Extended version of worker.py that ALSO speaks the MCP protocol.
Each deployed agent container runs this instead of the base worker.

Endpoints:
  Standard:
    GET  /health
    GET  /activity
    POST /chat

  MCP Protocol:
    GET  /mcp/tools          → list available tools
    POST /mcp/tools/{name}   → invoke a tool
    GET  /mcp/sse            → SSE stream (tool manifest + heartbeat)
    POST /mcp/messages       → MCP message envelope (for MCP-native clients)
"""

import os
import json
import uuid
import asyncio
from typing import Optional, AsyncGenerator
from datetime import datetime

import httpx
import chromadb
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(title=f"KRONOS Worker: {os.getenv('KRONOS_AGENT_NAME', 'unnamed')}")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Config ────────────────────────────────────────────────────────────────────

AGENT_ID        = os.getenv("KRONOS_AGENT_ID", str(uuid.uuid4()))
AGENT_NAME      = os.getenv("KRONOS_AGENT_NAME", "Worker")
AGENT_TYPE      = os.getenv("KRONOS_AGENT_TYPE", "custom")
MODEL           = os.getenv("KRONOS_MODEL", "llama3.2")
OLLAMA_URL      = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
CHROMA_COLLECTION = os.getenv("CHROMA_COLLECTION", "")
EMBED_MODEL     = os.getenv("EMBED_MODEL", "nomic-embed-text")
SYSTEM_PROMPT   = os.getenv("SYSTEM_PROMPT", "You are a helpful AI assistant with specialized knowledge.")

# ── State ─────────────────────────────────────────────────────────────────────

current_activity = {
    "status": "idle",
    "last_query": None,
    "query_count": 0,
    "last_tool": None,
    "mcp_calls": 0,
}

# ── Tool definitions (matches server-side AGENT_TYPE_TOOLS) ───────────────────

TOOLS_BY_TYPE = {
    "url_crawler": [
        {"name": "query_web_knowledge", "description": "Query the web-crawled knowledge base.", "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "top_k": {"type": "integer", "default": 5}}, "required": ["query"]}},
        {"name": "chat_with_web_knowledge", "description": "Chat using web knowledge context.", "inputSchema": {"type": "object", "properties": {"message": {"type": "string"}, "history": {"type": "array"}}, "required": ["message"]}},
    ],
    "db_learner": [
        {"name": "query_database_knowledge", "description": "Query structured database knowledge.", "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "top_k": {"type": "integer", "default": 5}}, "required": ["query"]}},
        {"name": "get_data_summary", "description": "Get a data summary from the knowledge base.", "inputSchema": {"type": "object", "properties": {"topic": {"type": "string"}}, "required": ["topic"]}},
    ],
    "folder_watcher": [
        {"name": "query_documents", "description": "Search ingested documents.", "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "top_k": {"type": "integer", "default": 5}}, "required": ["query"]}},
        {"name": "extract_from_documents", "description": "Extract specific info from documents.", "inputSchema": {"type": "object", "properties": {"extraction_request": {"type": "string"}}, "required": ["extraction_request"]}},
    ],
    "rag_validator": [
        {"name": "validate_rag_response", "description": "Validate a RAG-generated answer.", "inputSchema": {"type": "object", "properties": {"question": {"type": "string"}, "answer": {"type": "string"}, "context": {"type": "string"}}, "required": ["question", "answer"]}},
        {"name": "score_relevance", "description": "Score passage relevance to a query.", "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "passages": {"type": "array"}}, "required": ["query", "passages"]}},
    ],
    "custom": [
        {"name": "query_knowledge", "description": "Query the knowledge base.", "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "top_k": {"type": "integer", "default": 5}}, "required": ["query"]}},
        {"name": "chat", "description": "Chat with this specialized agent.", "inputSchema": {"type": "object", "properties": {"message": {"type": "string"}, "history": {"type": "array"}}, "required": ["message"]}},
    ],
}

UNIVERSAL_TOOL = {
    "name": "get_agent_info",
    "description": "Get metadata about this agent.",
    "inputSchema": {"type": "object", "properties": {}},
}


def get_tools():
    return TOOLS_BY_TYPE.get(AGENT_TYPE, TOOLS_BY_TYPE["custom"]) + [UNIVERSAL_TOOL]


# ── ChromaDB + Embedding ──────────────────────────────────────────────────────

def get_chroma_collection():
    if not CHROMA_COLLECTION:
        return None
    try:
        client = chromadb.PersistentClient(path="/root/.chroma")
        return client.get_collection(CHROMA_COLLECTION)
    except Exception:
        return None


async def embed(text: str) -> list:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
        )
        return r.json()["embedding"]


# ── Core RAG + Chat ───────────────────────────────────────────────────────────

async def rag_chat(message: str, history: list = None, top_k: int = 5) -> dict:
    global current_activity
    current_activity.update({
        "status": "processing",
        "last_query": message[:80],
        "query_count": current_activity["query_count"] + 1,
        "started_at": datetime.utcnow().isoformat(),
    })

    context = ""
    sources = []
    collection = get_chroma_collection()
    if collection:
        try:
            q_emb = await embed(message)
            results = collection.query(
                query_embeddings=[q_emb],
                n_results=top_k,
                include=["documents", "metadatas", "distances"],
            )
            for doc, meta, dist in zip(
                results["documents"][0],
                results["metadatas"][0],
                results["distances"][0],
            ):
                context += f"\n[Source: {meta.get('source','unknown')}]\n{doc}\n"
                sources.append({"source": meta.get("source"), "relevance": round(1 - dist, 3)})
        except Exception:
            pass

    system = SYSTEM_PROMPT
    if context:
        system += f"\n\nRelevant context from knowledge base:\n{context}"

    messages = [{"role": "system", "content": system}]
    if history:
        messages += history
    messages.append({"role": "user", "content": message})

    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/chat",
            json={"model": MODEL, "messages": messages, "stream": False},
        )
        r.raise_for_status()
        data = r.json()

    reply = data["message"]["content"]
    current_activity["status"] = "idle"

    return {
        "reply": reply,
        "sources": sources,
        "model": MODEL,
        "kb_used": bool(context),
        "agent": AGENT_NAME,
        "agent_id": AGENT_ID,
    }


# ── Standard endpoints ────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    history: Optional[list] = None
    top_k: int = 5


@app.get("/health")
async def health():
    return {
        "agent_id": AGENT_ID,
        "agent_name": AGENT_NAME,
        "agent_type": AGENT_TYPE,
        "model": MODEL,
        "kb_loaded": bool(CHROMA_COLLECTION),
        "status": "running",
        "mcp_enabled": True,
    }


@app.get("/activity")
async def activity():
    return {**current_activity, "agent_name": AGENT_NAME, "model": MODEL}


@app.post("/chat")
async def chat(req: ChatRequest):
    return await rag_chat(req.message, req.history, req.top_k)


# ── MCP endpoints ─────────────────────────────────────────────────────────────

@app.get("/mcp/tools")
async def mcp_list_tools():
    """MCP tool discovery endpoint."""
    return {
        "tools": get_tools(),
        "agent_id": AGENT_ID,
        "agent_name": AGENT_NAME,
        "agent_type": AGENT_TYPE,
        "model": MODEL,
    }


class MCPCallRequest(BaseModel):
    arguments: dict = {}
    call_id: Optional[str] = None


@app.post("/mcp/tools/{tool_name}")
async def mcp_call_tool(tool_name: str, req: MCPCallRequest):
    """Invoke an MCP tool by name."""
    global current_activity
    call_id = req.call_id or str(uuid.uuid4())
    current_activity["last_tool"] = tool_name
    current_activity["mcp_calls"] = current_activity.get("mcp_calls", 0) + 1

    valid_tools = {t["name"] for t in get_tools()}
    if tool_name not in valid_tools:
        return {
            "call_id": call_id,
            "is_error": True,
            "result": {"error": f"Tool '{tool_name}' not available"},
        }

    if tool_name == "get_agent_info":
        return {
            "call_id": call_id,
            "result": {
                "id": AGENT_ID, "name": AGENT_NAME, "type": AGENT_TYPE,
                "model": MODEL, "kb_loaded": bool(CHROMA_COLLECTION),
                "tools": [t["name"] for t in get_tools()],
            }
        }

    args = req.arguments
    # Route all tool types to rag_chat
    query = args.get("query") or args.get("message") or args.get("topic") or args.get("extraction_request") or ""

    if tool_name == "validate_rag_response":
        query = f"Validate this answer:\nQ: {args.get('question')}\nA: {args.get('answer')}\nContext: {args.get('context','N/A')}"
    elif tool_name == "score_relevance":
        passages_text = "\n---\n".join(args.get("passages", []))
        query = f"Score the relevance (0-1) of each passage to: '{args.get('query')}'\n{passages_text}"

    try:
        result = await rag_chat(query, args.get("history"), args.get("top_k", 5))
        return {"call_id": call_id, "tool_name": tool_name, "result": result, "is_error": False}
    except Exception as e:
        return {"call_id": call_id, "tool_name": tool_name, "result": {"error": str(e)}, "is_error": True}


@app.post("/mcp/messages")
async def mcp_messages(request: dict):
    """
    MCP message envelope endpoint for MCP-native clients.
    Handles the MCP JSON-RPC style protocol.
    """
    method = request.get("method", "")
    params = request.get("params", {})
    req_id = request.get("id")

    if method == "tools/list":
        return {
            "id": req_id,
            "result": {"tools": get_tools()},
        }
    elif method == "tools/call":
        tool_name = params.get("name")
        arguments = params.get("arguments", {})
        call_result = await mcp_call_tool(tool_name, MCPCallRequest(arguments=arguments))
        return {
            "id": req_id,
            "result": {
                "content": [{"type": "text", "text": json.dumps(call_result.get("result", {}))}],
                "isError": call_result.get("is_error", False),
            },
        }
    elif method == "initialize":
        return {
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": f"kronos-{AGENT_NAME}", "version": "1.0.0"},
            },
        }
    else:
        return {"id": req_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}


@app.get("/mcp/sse")
async def mcp_sse():
    """SSE stream: sends tool manifest on connect, then heartbeats every 15s."""
    async def stream() -> AsyncGenerator[str, None]:
        manifest = {
            "type": "tool_manifest",
            "agent_id": AGENT_ID,
            "agent_name": AGENT_NAME,
            "agent_type": AGENT_TYPE,
            "model": MODEL,
            "tools": get_tools(),
        }
        yield f"data: {json.dumps(manifest)}\n\n"
        while True:
            await asyncio.sleep(15)
            yield f"data: {json.dumps({'type': 'heartbeat', 'agent_id': AGENT_ID, 'status': 'running', 'timestamp': datetime.utcnow().isoformat(), 'activity': current_activity['status']})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
