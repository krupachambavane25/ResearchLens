import json
import time
from collections.abc import Callable
from typing import TypeVar

import httpx
from google import genai
from google.genai import errors, types

from backend.config import get_settings
from backend.models import Paper, SupportingDocument
from backend.services.analysis import (
    SYSTEM_INSTRUCTIONS,
    validate_ai_result,
)

MAX_TOTAL_PAPER_CONTEXT_CHARS = 180_000
MAX_TEXT_CHUNK_CHARS = 8_000
MAX_EMBEDDING_CHUNK_CHARS = 4_000
T = TypeVar("T")


class ProviderError(RuntimeError):
    pass


def _provider_error(code: int) -> ProviderError:
    messages = {
        400: "Gemini rejected the request. Check the configured model and request settings.",
        401: "Gemini rejected the API key. Check that GEMINI_API_KEY is valid.",
        403: "Gemini denied access. Check API key permissions and model availability.",
        404: "The configured Gemini model was not found. Check GEMINI_MODEL.",
        429: "Gemini rate limit or quota reached. Check your usage limits and retry later.",
    }
    if code in messages:
        return ProviderError(messages[code])
    if 500 <= code < 600:
        return ProviderError("Gemini is temporarily unavailable. Please retry later.")
    return ProviderError(f"Gemini request failed (HTTP {code or 'unknown'}).")


def _client(api_key: str):
    return genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(
            timeout=45_000,
            retry_options=types.HttpRetryOptions(attempts=1),
        ),
    )


def _with_retries(operation: Callable[[], T]) -> T:
    for attempt in range(3):
        try:
            return operation()
        except errors.APIError as exc:
            code = exc.code if isinstance(exc.code, int) else 0
            if code == 429 or 500 <= code < 600:
                if attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
                    continue
            raise _provider_error(code) from exc
        except (httpx.TimeoutException, httpx.ConnectError, TimeoutError, OSError) as exc:
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise ProviderError("Gemini request timed out or returned an invalid response.") from exc
    raise ProviderError("Gemini request failed after retries.")


def _paper_context(papers: list[Paper]) -> str:
    per_paper_budget = max(8_000, MAX_TOTAL_PAPER_CONTEXT_CHARS // len(papers))
    blocks = []
    for paper in papers:
        text = paper.extracted_text[:per_paper_budget]
        chunks = []
        while text:
            boundary = text.rfind("\n", 0, MAX_TEXT_CHUNK_CHARS)
            if boundary < MAX_TEXT_CHUNK_CHARS // 2:
                boundary = min(len(text), MAX_TEXT_CHUNK_CHARS)
            chunk, text = text[:boundary].strip(), text[boundary:].lstrip()
            if chunk:
                chunks.append(chunk)
        coverage = min(len(paper.extracted_text), per_paper_budget)
        blocks.append(
            f"<untrusted-paper paper_id={json.dumps(paper.id)} "
            f"title={json.dumps(paper.title)} filename={json.dumps(paper.filename)}>\n"
            f"Text coverage: {coverage} of {len(paper.extracted_text)} characters. "
            "The source is divided into sequential chunks; omitted trailing text must not be inferred.\n"
            + "\n".join(
                f"<source-chunk index={index + 1}>{chunk}</source-chunk>"
                for index, chunk in enumerate(chunks)
            )
            + "\n</untrusted-paper>"
        )
    return "\n\n".join(blocks)


def _document_context(documents: list[SupportingDocument]) -> str:
    return "\n\n".join(
        f"<untrusted-supporting-document filename={json.dumps(document.filename)}>\n"
        f"{document.content[:20000]}\n</untrusted-supporting-document>"
        for document in documents
    )


def analyze(
    papers: list[Paper],
    prompt: str,
    mode: str,
    criteria: list[str],
    questions: list[str],
    report_format: str,
    supporting_documents: list[SupportingDocument] | None = None,
) -> dict:
    settings = get_settings()
    if not settings.live_ai_enabled:
        raise ProviderError("Gemini API key is not configured.")
    user_request = {
        "user_instructions": prompt,
        "analysis_mode": mode,
        "comparison_criteria": criteria,
        "domain_questions": questions,
        "report_format": report_format,
        "papers": _paper_context(papers),
        "optional_supporting_documents": _document_context(supporting_documents or []),
    }
    client = _client(settings.gemini_api_key)
    try:
        response = _with_retries(
            lambda: client.models.generate_content(
                model=settings.gemini_model,
                contents=json.dumps(user_request),
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_INSTRUCTIONS,
                    response_mime_type="application/json",
                    response_schema={
                        "type": "OBJECT",
                        "properties": {
                            "executive_summary": {"type": "STRING"},
                            "paper_summaries": {"type": "ARRAY", "items": {"type": "OBJECT"}},
                            "comparison": {"type": "ARRAY", "items": {"type": "OBJECT"}},
                            "similarities": {"type": "ARRAY", "items": {"type": "OBJECT"}},
                            "repeated_limitations": {"type": "ARRAY", "items": {"type": "OBJECT"}},
                            "research_gaps": {"type": "ARRAY", "items": {"type": "OBJECT"}},
                            "research_questions": {"type": "ARRAY", "items": {"type": "OBJECT"}},
                            "future_directions": {"type": "ARRAY", "items": {"type": "OBJECT"}},
                            "limitations": {"type": "ARRAY", "items": {"type": "OBJECT"}},
                            "confidence": {"type": "NUMBER"},
                        },
                        "required": [
                            "executive_summary",
                            "paper_summaries",
                            "comparison",
                            "similarities",
                            "repeated_limitations",
                            "research_gaps",
                            "research_questions",
                            "future_directions",
                            "limitations",
                            "confidence",
                        ],
                    },
                    temperature=0.2,
                ),
            )
        )
        if not response.text:
            raise ValueError("Gemini returned an empty analysis.")
        data = json.loads(response.text)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ProviderError("Gemini returned an unreadable analysis. Please retry.") from exc
    finally:
        client.close()
    try:
        return validate_ai_result(data, papers)
    except ValueError as exc:
        raise ProviderError("Gemini returned analysis that did not match the required evidence schema.") from exc


def embed(text: str) -> list[float]:
    settings = get_settings()
    if not settings.live_ai_enabled:
        raise ProviderError("Gemini API key is not configured.")
    starts = sorted(
        {
            0,
            max(0, (len(text) - MAX_EMBEDDING_CHUNK_CHARS) // 2),
            max(0, len(text) - MAX_EMBEDDING_CHUNK_CHARS),
        }
    )
    chunks = [text[start : start + MAX_EMBEDDING_CHUNK_CHARS] for start in starts]
    client = _client(settings.gemini_api_key)
    try:
        response = _with_retries(
            lambda: client.models.embed_content(
                model=settings.gemini_embedding_model,
                contents=chunks,
                config=types.EmbedContentConfig(task_type="SEMANTIC_SIMILARITY"),
            )
        )
        vectors = [entry.values for entry in response.embeddings or []]
        if (
            len(vectors) != len(chunks)
            or not vectors
            or any(vector is None for vector in vectors)
            or any(len(vector) != len(vectors[0]) for vector in vectors)
        ):
            raise ValueError("Embedding vectors have inconsistent sizes.")
        return [
            sum(float(vector[index]) for vector in vectors) / len(vectors)
            for index in range(len(vectors[0]))
        ]
    except (KeyError, TypeError, ValueError) as exc:
        raise ProviderError("Gemini returned an invalid embedding.") from exc
    finally:
        client.close()
