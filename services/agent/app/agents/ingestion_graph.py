from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from app.document_parsing import ParsedDocument
from app.extraction import (
    build_heuristic_response,
    extract_with_openai,
)
from app.schemas import (
    DocumentProcessRequest,
    DocumentProcessResponse,
    VectorReferencePayload,
)
from app.tools.document_tools import (
    DocumentChunk,
    chunk_parsed_document,
    parse_document_for_request,
)
from app.tools.vector_tools import should_store_vectors, store_chunks_in_qdrant


class IngestionState(TypedDict, total=False):
    request: DocumentProcessRequest
    parsed_document: ParsedDocument
    response: DocumentProcessResponse
    chunks: list[DocumentChunk]
    vector_references: list[VectorReferencePayload]


def parse_document_node(state: IngestionState) -> IngestionState:
    request = state["request"]
    return {"parsed_document": parse_document_for_request(request)}


def extract_document_node(state: IngestionState) -> IngestionState:
    request = state["request"]
    parsed_document = state["parsed_document"]
    extractor_mode = str(request.processing_options.get("extractorMode", "")).lower()

    if extractor_mode == "heuristic":
        response = build_heuristic_response(request, parsed_document)
    else:
        response = extract_with_openai(request, parsed_document)

    return {"response": response}


def chunk_document_node(state: IngestionState) -> IngestionState:
    request = state["request"]
    parsed_document = state["parsed_document"]
    return {"chunks": chunk_parsed_document(request, parsed_document)}


def store_vectors_node(state: IngestionState) -> IngestionState:
    request = state["request"]
    response = state["response"]
    chunks = state.get("chunks", [])

    if not should_store_vectors(request.processing_options):
        return {"vector_references": []}

    return {
        "vector_references": store_chunks_in_qdrant(
            chunks,
            document_type=response.document_type,
        )
    }


def attach_vectors_node(state: IngestionState) -> IngestionState:
    response = state["response"]
    return {
        "response": response.model_copy(
            update={"vector_references": state.get("vector_references", [])}
        )
    }


def build_ingestion_graph():
    graph = StateGraph(IngestionState)
    graph.add_node("parse_document", parse_document_node)
    graph.add_node("extract_document", extract_document_node)
    graph.add_node("chunk_document", chunk_document_node)
    graph.add_node("store_vectors", store_vectors_node)
    graph.add_node("attach_vectors", attach_vectors_node)

    graph.add_edge(START, "parse_document")
    graph.add_edge("parse_document", "extract_document")
    graph.add_edge("extract_document", "chunk_document")
    graph.add_edge("chunk_document", "store_vectors")
    graph.add_edge("store_vectors", "attach_vectors")
    graph.add_edge("attach_vectors", END)
    return graph.compile()


INGESTION_GRAPH = build_ingestion_graph()


def run_ingestion_graph(request: DocumentProcessRequest) -> DocumentProcessResponse:
    final_state = INGESTION_GRAPH.invoke({"request": request})
    return final_state["response"]
