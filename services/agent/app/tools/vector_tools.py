import os
import uuid
from typing import Any

from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams

from app.errors import DocumentProcessingError
from app.schemas import VectorReferencePayload
from app.tools.document_tools import DocumentChunk


def qdrant_collection_name() -> str:
    return os.getenv("QDRANT_COLLECTION", "revenue_brains_documents")


def should_store_vectors(processing_options: dict[str, Any]) -> bool:
    vector_mode = str(processing_options.get("vectorMode", "")).lower()
    extractor_mode = str(processing_options.get("extractorMode", "")).lower()
    if vector_mode == "disabled":
        return False
    if extractor_mode == "heuristic" and vector_mode != "mock":
        return False
    return True


def store_chunks_in_qdrant(
    chunks: list[DocumentChunk],
    *,
    document_type: str,
) -> list[VectorReferencePayload]:
    if not chunks:
        return []

    qdrant_url = os.getenv("QDRANT_URL", "http://localhost:6333")
    qdrant_api_key = os.getenv("QDRANT_API_KEY") or None
    collection_name = qdrant_collection_name()
    embedding_model = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
    vector_size = int(os.getenv("QDRANT_VECTOR_SIZE", "1536"))

    try:
        client = QdrantClient(url=qdrant_url, api_key=qdrant_api_key)
        if not client.collection_exists(collection_name):
            client.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
            )

        embeddings = OpenAIEmbeddings(model=embedding_model)
        vector_store = QdrantVectorStore(
            client=client,
            collection_name=collection_name,
            embedding=embeddings,
        )
        point_ids = [str(uuid.uuid5(uuid.NAMESPACE_URL, chunk.chunk_id)) for chunk in chunks]
        documents = [
            Document(
                page_content=chunk.text,
                metadata={
                    **chunk.metadata,
                    "documentType": document_type,
                    "chunkId": chunk.chunk_id,
                    "contentPreview": chunk.content_preview,
                },
            )
            for chunk in chunks
        ]
        vector_store.add_documents(documents=documents, ids=point_ids)
    except Exception as exc:  # noqa: BLE001
        raise DocumentProcessingError(
            "vector_store_failed",
            "Qdrant vector storage failed during document ingestion.",
            status_code=503,
            details={"collection": collection_name},
        ) from exc

    return [
        VectorReferencePayload(
            chunkId=chunk.chunk_id,
            qdrantCollection=collection_name,
            qdrantPointId=point_id,
            chunkIndex=chunk.chunk_index,
            contentPreview=chunk.content_preview,
            metadata={**chunk.metadata, "documentType": document_type},
        )
        for chunk, point_id in zip(chunks, point_ids, strict=True)
    ]


def retrieve_qdrant_context(
    question: str,
    *,
    workspace_id: str,
    limit: int = 5,
) -> list[dict[str, Any]]:
    qdrant_url = os.getenv("QDRANT_URL", "http://localhost:6333")
    qdrant_api_key = os.getenv("QDRANT_API_KEY") or None
    collection_name = qdrant_collection_name()
    embedding_model = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")

    try:
        client = QdrantClient(url=qdrant_url, api_key=qdrant_api_key)
        if not client.collection_exists(collection_name):
            return []

        embeddings = OpenAIEmbeddings(model=embedding_model)
        vector_store = QdrantVectorStore(
            client=client,
            collection_name=collection_name,
            embedding=embeddings,
        )
        results = vector_store.similarity_search_with_score(question, k=limit)
    except Exception as exc:  # noqa: BLE001
        raise DocumentProcessingError(
            "vector_retrieval_failed",
            "Qdrant retrieval failed during Q&A.",
            status_code=503,
            details={"collection": collection_name},
        ) from exc

    context = []
    for document, score in results:
        metadata = document.metadata or {}
        if metadata.get("workspaceId") != workspace_id:
            continue
        context.append(
            {
                "content": document.page_content,
                "score": score,
                "metadata": metadata,
            }
        )

    return context
