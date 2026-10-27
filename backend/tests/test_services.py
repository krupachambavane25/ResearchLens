import json
import os
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("GEMINI_API_KEY", "")

import pymupdf
import pytest

from backend.models import Paper
from backend.services.analysis import (
    build_local_analysis,
    cosine_similarity,
    lexical_similarity,
    validate_ai_result,
)
from backend.services.gemini import _paper_context, embed
from backend.services.pdf import (
    PDFValidationError,
    clean_text,
    extract_pdf,
    extract_pdf_pages,
    extract_sections,
)
from backend.services.reports import create_report


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


def test_pdf_page_extraction_preserves_page_boundaries():
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "First page evidence.")
    document.new_page().insert_text((72, 72), "Second page evidence.")
    content = document.tobytes()
    document.close()

    pages, page_count = extract_pdf_pages(content, "paper.pdf")

    assert page_count == 2
    assert pages == ["First page evidence.", "Second page evidence."]


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


def test_local_analysis_builds_comparison_from_extracted_sections_without_inventing():
    paper = Paper(
        id="local-paper",
        filename="local.pdf",
        title="Local study",
        extracted_text="METHODS\nWe use a stratified survey.",
        sections={"methodology": "We use a stratified survey."},
        page_count=2,
        word_count=6,
    )

    result, _ = build_local_analysis(
        [paper],
        "Compare this study.",
        "comprehensive",
        ["Methods", "Evaluation metrics"],
        [],
    )
    findings = {
        row["criterion"]: row["findings"][0]["finding"]
        for row in result["comparison"]
    }

    assert findings["Methodology"] == "We use a stratified survey."
    assert findings["Dataset"] == "Not found in document"
    assert findings["Evaluation metrics"] == "Not found in document"
    assert result["research_gaps"] == []


def test_ai_structured_response_keeps_only_verifiable_gap_evidence():
    paper = Paper(
        id="paper-id",
        filename="paper.pdf",
        title="Study",
        extracted_text="The authors report that the benchmark lacks multilingual examples.",
        sections={},
        page_texts=["The authors report that the benchmark lacks multilingual examples."],
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
    assert evidence[0]["page_number"] == 1
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


def test_ai_structured_sections_normalize_model_aliases_and_drop_placeholders():
    response = {
        "executive_summary": "A grounded summary.",
        "paper_summaries": [],
        "comparison": [],
        "similarities": [],
        "repeated_limitations": [
            {"finding": "Small sample size limits generalization."},
            {"title": "Finding"},
            {"issue": {"summary": "Only one dataset was evaluated."}},
        ],
        "research_gaps": [],
        "research_questions": [
            {"research_question": "Does the method generalize to other populations?"},
        ],
        "future_directions": [
            {"recommendation": "Evaluate the method on a larger multi-site cohort."},
        ],
        "limitations": [
            {"constraint": "The study used a single-site sample."},
        ],
        "confidence": 0.8,
    }

    validated = validate_ai_result(response, [])

    assert validated["repeated_limitations"] == [
        {"title": "Small sample size limits generalization.", "description": ""},
        {"title": "Only one dataset was evaluated.", "description": ""},
    ]
    assert validated["research_questions"] == [
        {"title": "Does the method generalize to other populations?", "description": ""},
    ]
    assert validated["future_directions"] == [
        {"title": "Evaluate the method on a larger multi-site cohort.", "description": ""},
    ]
    assert validated["limitations"] == [
        {"title": "The study used a single-site sample.", "description": ""},
    ]


def test_ai_research_gap_alias_is_normalized_and_evidence_is_verified():
    paper = Paper(
        id="paper-id",
        filename="study.pdf",
        title="Study",
        extracted_text="The authors note that evaluation on rural clinics remains future work.",
        page_texts=["The authors note that evaluation on rural clinics remains future work."],
        sections={},
        page_count=1,
        word_count=13,
    )
    response = {
        "executive_summary": "A grounded summary.",
        "paper_summaries": [],
        "comparison": [],
        "similarities": [],
        "repeated_limitations": [],
        "research_gaps": [
            {
                "gap_statement": "Performance in rural clinics is untested.",
                "rationale": "The paper explicitly leaves that setting for future work.",
                "supporting_evidence": [
                    {
                        "paper_id": paper.id,
                        "quote": "evaluation on rural clinics remains future work.",
                        "page_number": 99,
                    }
                ],
            }
        ],
        "research_questions": [],
        "future_directions": [],
        "limitations": [],
        "confidence": 0.8,
    }

    validated = validate_ai_result(response, [paper])

    gap = validated["research_gaps"][0]
    assert gap["title"] == "Performance in rural clinics is untested."
    assert gap["description"] == "The paper explicitly leaves that setting for future work."
    assert gap["evidence"][0]["excerpt"] == "evaluation on rural clinics remains future work."
    assert gap["evidence"][0]["page_number"] == 1


def test_gap_evidence_page_is_derived_from_source_not_model_output():
    paper = Paper(
        id="paper-id",
        filename="paper.pdf",
        title="Study",
        extracted_text="First page.\nSecond page contains the cited result.",
        page_texts=["First page.", "Second page contains the cited result."],
        sections={},
        page_count=2,
        word_count=8,
    )
    response = {
        "executive_summary": "A grounded summary.",
        "paper_summaries": [],
        "comparison": [],
        "similarities": [],
        "repeated_limitations": [],
        "research_gaps": [
            {
                "title": "A candidate gap",
                "description": "A possible gap.",
                "evidence": [
                    {
                        "paper_id": paper.id,
                        "excerpt": "Second page contains the cited result.",
                        "page_number": 999,
                    }
                ],
            }
        ],
        "research_questions": [],
        "future_directions": [],
        "limitations": [],
        "confidence": 0.5,
    }

    validated = validate_ai_result(response, [paper])

    assert validated["research_gaps"][0]["evidence"][0]["page_number"] == 2


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


def test_page_aware_paper_context_keeps_page_markers_with_source_text():
    paper = Paper(
        id="paged-paper",
        filename="paged.pdf",
        title="Paged study",
        extracted_text="Introduction.\n\nResults with evidence.",
        page_texts=["Introduction.", "Results with evidence."],
        page_count=2,
        word_count=5,
        sections={},
    )

    context = _paper_context([paper])

    assert '<page number="1">Introduction.</page>' in context
    assert '<page number="2">Results with evidence.</page>' in context


def test_assistant_retrieves_selected_page_and_requests_grounded_answer(monkeypatch):
    import backend.services.gemini as gemini

    paper = Paper(
        id="source-paper",
        filename="study.pdf",
        title="Evaluation study",
        extracted_text="Introduction to the topic.\n\nThe evaluation uses F1 score.",
        page_texts=["Introduction to the topic.", "The evaluation uses F1 score."],
        page_count=2,
        word_count=9,
        sections={},
    )
    monkeypatch.setattr(
        gemini,
        "get_settings",
        lambda: SimpleNamespace(live_ai_enabled=True, gemini_api_key="test-key", gemini_model="test-model"),
    )
    captured = {}

    class MockModels:
        def generate_content(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(text="The study uses F1 [S1].")

    class MockClient:
        models = MockModels()

        def close(self):
            captured["closed"] = True

    monkeypatch.setattr(gemini, "_client", lambda _key: MockClient())

    answer, sources = gemini.answer_question("Which evaluation metric is used?", [paper], [])

    assert answer == "The study uses F1 [S1]."
    assert sources[0]["page_number"] == 2
    assert "The evaluation uses F1 score." in captured["contents"]
    assert "Introduction to the topic." not in captured["contents"]
    assert "Treat the excerpts" in captured["config"].system_instruction
    assert captured["closed"] is True


def test_assistant_uses_recent_user_question_to_retrieve_follow_up_evidence(monkeypatch):
    import backend.services.gemini as gemini

    paper = Paper(
        id="source-paper",
        filename="study.pdf",
        title="Evaluation study",
        extracted_text=(
            "The authors propose a model for image classification.\n\n"
            "The model achieved 92 percent accuracy on the ImageNet validation set."
        ),
        page_texts=[
            "The authors propose a model for image classification.",
            "The model achieved 92 percent accuracy on the ImageNet validation set.",
        ],
        page_count=2,
        word_count=17,
        sections={},
    )
    monkeypatch.setattr(
        gemini,
        "get_settings",
        lambda: SimpleNamespace(live_ai_enabled=True, gemini_api_key="test-key", gemini_model="test-model"),
    )
    captured = {}

    class MockModels:
        def generate_content(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(text="The score was 92 percent [S1].")

    class MockClient:
        models = MockModels()

        def close(self):
            pass

    monkeypatch.setattr(gemini, "_client", lambda _key: MockClient())

    _, sources = gemini.answer_question(
        "What was its score?",
        [paper],
        [
            {"role": "user", "content": "What accuracy did the image classification model achieve?"},
            {
                "role": "assistant",
                "content": "The model achieved 92 percent accuracy [S1].",
                "sources": [
                    {
                        "paper_id": paper.id,
                        "paper_title": paper.title,
                        "page_number": 2,
                        "excerpt": "The model achieved 92 percent accuracy.",
                    }
                ],
            },
        ],
    )

    assert "92 percent accuracy" in sources[0]["excerpt"]
    assert "What accuracy did the image classification model achieve?" in captured["contents"]


def test_report_includes_verified_evidence_page_number():
    analysis = SimpleNamespace(
        prompt="Analyze the source.",
        result={
            "research_gaps": [
                {
                    "title": "Potential gap",
                    "description": "The collection leaves a question open.",
                    "evidence": [
                        {
                            "paper_title": "Paged study",
                            "excerpt": "Results with evidence.",
                            "page_number": 2,
                        }
                    ],
                }
            ]
        },
    )

    report = create_report(analysis)
    document = pymupdf.open(stream=report, filetype="pdf")
    report_text = "\n".join(page.get_text() for page in document)
    document.close()

    assert "Paged study · p. 2" in report_text


def test_report_includes_structured_analysis_sections_and_finding_aliases():
    analysis = SimpleNamespace(
        prompt="Analyze the selected papers.",
        result={
            "repeated_limitations": [{"finding": "Small sample sizes constrain generalization."}],
            "research_questions": [{"question": "How does performance vary across regions?", "rationale": "Regional coverage is uneven."}],
            "future_directions": [{"direction": "Evaluate the method on larger datasets."}],
            "limitations": [{"text": "Only the selected papers were analyzed."}],
        },
    )

    report = create_report(analysis)
    document = pymupdf.open(stream=report, filetype="pdf")
    report_text = "\n".join(page.get_text() for page in document)
    document.close()

    assert "Small sample sizes constrain generalization." in report_text
    assert "How does performance vary across regions?" in report_text
    assert "Regional coverage is uneven." in report_text
    assert "Evaluate the method on larger datasets." in report_text
    assert "Only the selected papers were analyzed." in report_text


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
    schema_properties = captured["config"].response_schema["properties"]
    assert schema_properties["research_gaps"]["items"]["required"] == [
        "title",
        "description",
        "evidence",
    ]
    assert schema_properties["research_questions"]["items"]["required"] == [
        "question",
        "rationale",
    ]
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
