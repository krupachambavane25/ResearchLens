import json
import os
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("GEMINI_API_KEY", "")

import pymupdf
import pytest

from backend.models import Paper
from backend.services.analysis import cosine_similarity, lexical_similarity, validate_ai_result
from backend.services.gemini import _paper_context, embed
from backend.services.pdf import PDFValidationError, clean_text, extract_pdf, extract_sections


def make_pdf(text: str) -> bytes:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), text)
    content = document.tobytes()
    document.close()
    return content


def make_encrypted_pdf() -> bytes:
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Password-protected paper.")
    content = document.tobytes(
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        owner_pw="owner",
        user_pw="reader",
    )
    document.close()
    return content


def test_pdf_extraction_cleans_text_and_reads_pages():
    text, pages = extract_pdf(make_pdf("Abstract\nResearchLens hyphen-\nated text."), "paper.pdf")
    assert pages == 1
    assert "hyphenated text" in text


@pytest.mark.parametrize(
    ("content", "filename", "message"),
    [
        (b"", "paper.pdf", "empty"),
        (b"not a pdf", "paper.pdf", "valid PDF"),
        (make_pdf("sample"), "paper.txt", "valid PDF"),
        (make_pdf(""), "paper.pdf", "No selectable text"),
    ],
)
def test_pdf_validation_rejects_invalid_or_empty_input(content, filename, message):
    with pytest.raises(PDFValidationError, match=message):
        extract_pdf(content, filename)


def test_pdf_validation_rejects_encrypted_documents():
    with pytest.raises(PDFValidationError, match="Encrypted PDFs are not supported"):
        extract_pdf(make_encrypted_pdf(), "protected.pdf")


def test_text_preprocessing_and_section_extraction():
    assert clean_text("A-\n  B\n\n\nC") == "AB\n\nC"
    sections = extract_sections(
        "ABSTRACT\nA short abstract.\n\nMETHODOLOGY\nWe compare two methods.\n\nRESULTS\nResults follow."
    )
    assert sections["abstract"] == "A short abstract."
    assert sections["methodology"] == "We compare two methods."
    assert sections["results"] == "Results follow."


def test_cosine_similarity_and_lexical_overlap():
    assert cosine_similarity([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1)
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0)
    assert lexical_similarity("neural network model", "neural network research") > 0
    with pytest.raises(ValueError):
        cosine_similarity([1.0], [1.0, 0.0])


def test_ai_structured_response_keeps_only_verifiable_gap_evidence():
    paper = Paper(
        id="paper-id",
        filename="paper.pdf",
        title="Study",
        extracted_text="The authors report that the benchmark lacks multilingual examples.",
        sections={},
        page_count=1,
        word_count=10,
    )
    response = {
        "executive_summary": "A grounded summary.",
        "paper_summaries": [],
        "comparison": [
            {
                "criterion": "Dataset",
                "findings": [
                    {"paper_id": paper.id, "finding": "One dataset."},
                    {"paper_id": "other-paper", "finding": "Unsupported source."},
                ],
            }
        ],
        "similarities": [],
        "repeated_limitations": [],
        "research_gaps": [
            {
                "title": "Language coverage",
                "description": "The benchmark may underrepresent languages.",
                "confidence": 0.5,
                "evidence": [
                    {
                        "paper_id": paper.id,
                        "excerpt": "the benchmark lacks multilingual examples.",
                        "page_number": 1000,
                    },
                    {"paper_id": "other-paper", "excerpt": "Unsupported source."},
                    {"paper_id": paper.id, "excerpt": "This quote is not in the source."},
                ],
                "counter_evidence": [],
                "uncertainty": "One supplied paper only.",
            }
        ],
        "research_questions": [],
        "future_directions": [],
        "limitations": [],
        "confidence": 0.5,
    }
    validated = validate_ai_result(response, [paper])
    assert len(validated["research_gaps"]) == 1
    evidence = validated["research_gaps"][0]["evidence"]
    assert len(evidence) == 1
    assert evidence[0]["page_number"] is None
    assert evidence[0]["paper_title"] == "Study"
    assert validated["comparison"] == [
        {
            "criterion": "Dataset",
            "findings": [
                {
                    "paper_id": "paper-id",
                    "paper_title": "Study",
                    "finding": "One dataset.",
                }
            ],
        }
    ]


def test_missing_required_ai_fields_raise_clear_error():
    with pytest.raises(ValueError, match="missing required fields"):
        validate_ai_result({}, [])


def test_ai_output_with_invalid_shape_or_confidence_is_rejected():
    response = {
        "executive_summary": "Summary",
        "paper_summaries": [],
        "comparison": [],
        "similarities": [],
        "repeated_limitations": [],
        "research_gaps": [],
        "research_questions": [],
        "future_directions": [],
        "limitations": [],
        "confidence": "high",
    }
    with pytest.raises(ValueError, match="confidence"):
        validate_ai_result(response, [])


def test_long_pdf_context_is_chunked_and_truncation_is_disclosed():
    paper = Paper(
        id="long-paper",
        filename="long.pdf",
        title="Long study",
        extracted_text="x\n" * 100_000,
        sections={},
        page_count=100,
        word_count=100_000,
    )
    context = _paper_context([paper])
    assert "Text coverage: 180000 of 200000 characters" in context
    assert "<source-chunk index=1>" in context
    assert "<source-chunk index=2>" in context
    assert "omitted trailing text must not be inferred" in context


def test_embedding_batches_bounded_chunks_and_averages_vectors(monkeypatch):
    import backend.services.gemini as gemini

    monkeypatch.setattr(
        gemini,
        "get_settings",
        lambda: SimpleNamespace(
            live_ai_enabled=True,
            gemini_embedding_model="gemini-embedding-001",
            gemini_api_key="test-key",
        ),
    )
    captured = {}

    class MockModels:
        def embed_content(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                embeddings=[
                    SimpleNamespace(values=[1.0, 0.0]),
                    SimpleNamespace(values=[0.0, 1.0]),
                    SimpleNamespace(values=[-1.0, 0.0]),
                ]
            )

    class MockClient:
        models = MockModels()

        def close(self):
            captured["closed"] = True

    monkeypatch.setattr(gemini, "_client", lambda api_key: MockClient())
    vector = embed("x" * 10_000)
    assert vector == pytest.approx([0.0, 1 / 3])
    assert captured["model"] == "gemini-embedding-001"
    assert captured["config"].task_type == "SEMANTIC_SIMILARITY"
    chunks = captured["contents"]
    assert len(chunks) == 3
    assert all(len(chunk) <= 4_000 for chunk in chunks)
    assert captured["closed"] is True


def test_gemini_analysis_uses_sdk_json_schema_and_validates_result(monkeypatch):
    import backend.services.gemini as gemini

    paper = Paper(
        id="paper-id",
        filename="paper.pdf",
        title="Study",
        extracted_text="A study of methods.",
        sections={},
        page_count=1,
        word_count=4,
    )
    result = {
        "executive_summary": "Grounded summary.",
        "paper_summaries": [],
        "comparison": [],
        "similarities": [],
        "repeated_limitations": [],
        "research_gaps": [],
        "research_questions": [],
        "future_directions": [],
        "limitations": [],
        "confidence": 0.8,
    }
    captured = {}

    class MockModels:
        def generate_content(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(text=json.dumps(result))

    class MockClient:
        models = MockModels()

        def close(self):
            captured["closed"] = True

    monkeypatch.setattr(
        gemini,
        "get_settings",
        lambda: SimpleNamespace(
            live_ai_enabled=True,
            gemini_model="gemini-3.8-flash",
            gemini_api_key="test-key",
        ),
    )
    monkeypatch.setattr(gemini, "_client", lambda api_key: MockClient())

    validated = gemini.analyze(
        [paper], "Compare methods.", "comprehensive", [], [], "detailed"
    )

    assert validated["executive_summary"] == "Grounded summary."
    assert captured["model"] == "gemini-3.8-flash"
    assert json.loads(captured["contents"])["user_instructions"] == "Compare methods."
    assert captured["config"].response_mime_type == "application/json"
    assert captured["config"].response_schema["required"]
    assert captured["closed"] is True


def test_gemini_sdk_retries_quota_errors_without_exposing_provider_details(monkeypatch):
    import backend.services.gemini as gemini
    from google.genai import errors

    attempts = 0

    def fail_with_quota():
        nonlocal attempts
        attempts += 1
        raise errors.APIError(
            code=429,
            response_json={"error": {"message": "private provider response"}},
        )

    monkeypatch.setattr(gemini.time, "sleep", lambda _seconds: None)
    with pytest.raises(gemini.ProviderError, match="rate limit or quota") as error:
        gemini._with_retries(fail_with_quota)
    assert attempts == 3
    assert "private provider response" not in str(error.value)
