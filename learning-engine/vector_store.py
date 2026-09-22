"""
Learning Engine — Vector Store Interface

Manages the Chroma vector database that powers the self-learning triage system.

Collections:
  - confirmed_vulns  : embeddings of confirmed, accepted vulnerabilities
  - false_positives  : embeddings of FP findings (to suppress similar ones)
  - payloads         : embeddings of successful exploit payloads by vuln type

Usage:
  store = VectorStore()
  store.add_confirmed_vuln(finding_context, metadata)
  results = store.find_similar(new_finding_context, n=5)
"""

import json
import os
from dataclasses import dataclass, field
from typing import Optional

import chromadb
from chromadb.config import Settings
import google.generativeai as genai

CHROMA_HOST = os.getenv("CHROMA_HOST", "localhost")
CHROMA_PORT = int(os.getenv("CHROMA_PORT", "8000"))
CHROMA_AUTH_TOKEN = os.getenv("CHROMA_AUTH_TOKEN", "")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")

# Configure Gemini for embeddings
if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)


@dataclass
class VulnContext:
    """Structured context for a vulnerability finding — used for embedding."""
    url: str
    vuln_type: str              # sqli, xss, idor, ssrf, etc
    parameter: Optional[str] = None
    payload: Optional[str] = None
    response_snippet: Optional[str] = None
    tech_stack: list[str] = field(default_factory=list)
    http_status: Optional[int] = None
    extra: dict = field(default_factory=dict)

    def to_text(self) -> str:
        """Convert to a text string suitable for embedding."""
        parts = [
            f"Vulnerability Type: {self.vuln_type}",
            f"URL: {self.url}",
        ]
        if self.parameter:
            parts.append(f"Parameter: {self.parameter}")
        if self.payload:
            parts.append(f"Payload: {self.payload}")
        if self.response_snippet:
            parts.append(f"Response: {self.response_snippet[:500]}")
        if self.tech_stack:
            parts.append(f"Tech Stack: {', '.join(self.tech_stack)}")
        if self.http_status:
            parts.append(f"HTTP Status: {self.http_status}")
        return "\n".join(parts)


class VectorStore:
    def __init__(self):
        if CHROMA_AUTH_TOKEN:
            try:
                # chromadb >= 1.x: plain bearer header
                self.client = chromadb.HttpClient(
                    host=CHROMA_HOST,
                    port=CHROMA_PORT,
                    headers={"Authorization": f"Bearer {CHROMA_AUTH_TOKEN}"},
                )
            except TypeError:
                # older chromadb: token auth provider
                self.client = chromadb.HttpClient(
                    host=CHROMA_HOST,
                    port=CHROMA_PORT,
                    settings=Settings(
                        chroma_client_auth_provider="chromadb.auth.token.TokenAuthClientProvider",
                        chroma_client_auth_credentials=CHROMA_AUTH_TOKEN,
                    ),
                )
        else:
            self.client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
        self._init_collections()

    def _init_collections(self):
        self.confirmed_vulns = self.client.get_or_create_collection(
            name="confirmed_vulns",
            metadata={"description": "Confirmed, accepted vulnerability contexts"},
        )
        self.false_positives = self.client.get_or_create_collection(
            name="false_positives",
            metadata={"description": "Known false positive contexts — suppress similar"},
        )
        self.payloads = self.client.get_or_create_collection(
            name="payloads",
            metadata={"description": "Successful exploit payloads by vulnerability type"},
        )

    def _embed(self, text: str) -> list[float]:
        """Generate embedding using Gemini text-embedding model."""
        result = genai.embed_content(
            model="models/text-embedding-004",
            content=text,
            task_type="RETRIEVAL_DOCUMENT",
        )
        return result["embedding"]

    def add_confirmed_vuln(self, context: VulnContext, report_id: str, metadata: dict = None) -> str:
        """Store a confirmed vulnerability in the vector DB."""
        text = context.to_text()
        embedding = self._embed(text)
        doc_id = f"vuln_{report_id}"
        meta = {
            "vuln_type": context.vuln_type,
            "url": context.url,
            "report_id": report_id,
            **(metadata or {}),
        }
        self.confirmed_vulns.add(
            ids=[doc_id],
            embeddings=[embedding],
            documents=[text],
            metadatas=[meta],
        )
        return doc_id

    def add_false_positive(self, context: VulnContext, reason: str, report_id: str) -> str:
        """Store a false positive so similar findings are deprioritised."""
        text = context.to_text()
        embedding = self._embed(text)
        doc_id = f"fp_{report_id}"
        self.false_positives.add(
            ids=[doc_id],
            embeddings=[embedding],
            documents=[text],
            metadatas=[{"vuln_type": context.vuln_type, "reason": reason, "report_id": report_id}],
        )
        return doc_id

    def add_successful_payload(self, vuln_type: str, payload: str, context_url: str, payload_id: str):
        """Store a payload that successfully triggered a vulnerability."""
        text = f"Vuln type: {vuln_type}\nPayload: {payload}\nContext URL: {context_url}"
        embedding = self._embed(text)
        self.payloads.add(
            ids=[f"payload_{payload_id}"],
            embeddings=[embedding],
            documents=[text],
            metadatas=[{"vuln_type": vuln_type, "payload": payload}],
        )

    def find_similar_confirmed(self, context: VulnContext, n: int = 5) -> list[dict]:
        """Find confirmed vulns most similar to this context (for triage scoring)."""
        text = context.to_text()
        embedding = self._embed(text)
        results = self.confirmed_vulns.query(
            query_embeddings=[embedding],
            n_results=min(n, self.confirmed_vulns.count() or 1),
            include=["documents", "metadatas", "distances"],
        )
        return self._format_results(results)

    def find_similar_fp(self, context: VulnContext, n: int = 3) -> list[dict]:
        """Find false positives most similar to this context (for FP suppression)."""
        if self.false_positives.count() == 0:
            return []
        text = context.to_text()
        embedding = self._embed(text)
        results = self.false_positives.query(
            query_embeddings=[embedding],
            n_results=min(n, self.false_positives.count()),
            include=["documents", "metadatas", "distances"],
        )
        return self._format_results(results)

    def get_payloads_for_vuln_type(self, vuln_type: str, n: int = 10) -> list[str]:
        """Retrieve historically successful payloads for a given vuln type."""
        if self.payloads.count() == 0:
            return []
        results = self.payloads.query(
            query_embeddings=[self._embed(f"Vuln type: {vuln_type}")],
            n_results=min(n, self.payloads.count()),
            where={"vuln_type": vuln_type},
            include=["metadatas"],
        )
        payloads = []
        for meta_list in results.get("metadatas", []):
            for meta in meta_list:
                if meta.get("payload"):
                    payloads.append(meta["payload"])
        return payloads

    def _format_results(self, results: dict) -> list[dict]:
        output = []
        ids = results.get("ids", [[]])[0]
        docs = results.get("documents", [[]])[0]
        metas = results.get("metadatas", [[]])[0]
        distances = results.get("distances", [[]])[0]
        for i, doc_id in enumerate(ids):
            similarity = 1.0 - distances[i] if distances else 0.0  # cosine: 1=identical
            output.append({
                "id": doc_id,
                "similarity": round(similarity, 4),
                "document": docs[i] if i < len(docs) else "",
                "metadata": metas[i] if i < len(metas) else {},
            })
        return output

    def collection_stats(self) -> dict:
        return {
            "confirmed_vulns": self.confirmed_vulns.count(),
            "false_positives": self.false_positives.count(),
            "payloads": self.payloads.count(),
        }
