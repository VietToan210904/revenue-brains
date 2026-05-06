from dataclasses import dataclass

from app.document_parsing import ParsedDocument, parse_document
from app.schemas import DocumentProcessRequest


@dataclass(frozen=True)
class DocumentChunk:
    chunk_id: str
    chunk_index: int
    text: str
    content_preview: str
    metadata: dict[str, str | int | None]


def parse_document_for_request(request: DocumentProcessRequest) -> ParsedDocument:
    return parse_document(
        request.file_storage_key,
        request.original_filename,
        request.content_type,
    )


def chunk_parsed_document(
    request: DocumentProcessRequest,
    parsed_document: ParsedDocument,
    *,
    chunk_size: int = 1200,
    overlap: int = 160,
) -> list[DocumentChunk]:
    text = " ".join(parsed_document.text.split())
    if not text:
        return []

    chunks: list[DocumentChunk] = []
    start = 0
    index = 0
    while start < len(text):
        chunk_text = text[start : start + chunk_size].strip()
        if chunk_text:
            chunk_id = f"{request.document_id}:chunk:{index}"
            chunks.append(
                DocumentChunk(
                    chunk_id=chunk_id,
                    chunk_index=index,
                    text=chunk_text,
                    content_preview=safe_preview(chunk_text),
                    metadata={
                        "workspaceId": request.workspace_id,
                        "conversationId": request.conversation_id,
                        "messageId": request.message_id,
                        "documentId": request.document_id,
                        "filename": request.original_filename,
                        "chunkIndex": index,
                    },
                )
            )
        index += 1
        if start + chunk_size >= len(text):
            break
        start += max(chunk_size - overlap, 1)

    return chunks


def safe_preview(text: str, limit: int = 220) -> str:
    cleaned = " ".join(text.split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: max(limit - 3, 0)].rstrip() + "..."
