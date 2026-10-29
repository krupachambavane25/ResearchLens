import os
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("GROQ_API_KEY", "")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import backend.main as main_module
from backend.database import Base, get_db
from backend.services.groq import ProviderError
from backend.tests.test_services import make_pdf


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    main_module.app.dependency_overrides[get_db] = override_db
    with TestClient(main_module.app) as test_client:
        yield test_client
    main_module.app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_legacy_paper_schema_migrates_page_text_column(monkeypatch):
    import backend.database as database_module

    legacy_engine = create_engine("sqlite://")
    with legacy_engine.begin() as connection:
        connection.execute(text("CREATE TABLE papers (id VARCHAR(36) PRIMARY KEY)"))
        connection.execute(text("CREATE TABLE analyses (id VARCHAR(36) PRIMARY KEY)"))
    monkeypatch.setattr(database_module, "engine", legacy_engine)

    database_module.migrate_owner_columns()

    columns = {column["name"] for column in inspect(legacy_engine).get_columns("papers")}
    analysis_columns = {column["name"] for column in inspect(legacy_engine).get_columns("analyses")}
    assert {"owner_id", "page_texts", "project_id"} <= columns
    assert {"owner_id", "project_id"} <= analysis_columns
    database_module.migrate_owner_columns()
    legacy_engine.dispose()


def add_paper(client: TestClient, token: str | None = None) -> str:
    headers = {"Authorization": f"Bearer {token}"} if token else None
    response = client.post(
        "/api/papers/upload",
        headers=headers,
        files=[
            (
                "files",
                ("study.pdf", make_pdf("ABSTRACT\nA study.\n\nMETHODS\nA method."), "application/pdf"),
            )
        ],
    )
    assert response.status_code == 200, response.text
    return response.json()["papers"][0]["id"]


def test_pdf_upload_validation_and_database_persistence(client):
    invalid = client.post(
        "/api/papers/upload",
        files=[("files", ("wrong.txt", b"not a pdf", "text/plain"))],
    )
    assert invalid.status_code == 415
    empty = client.post(
        "/api/papers/upload",
        files=[("files", ("empty.pdf", b"", "application/pdf"))],
    )
    assert empty.status_code == 422
    paper_id = add_paper(client)
    result = client.get("/api/papers")
    assert result.status_code == 200
    assert result.json()["papers"][0]["id"] == paper_id
    detail = client.get(f"/api/papers/{paper_id}")
    assert detail.status_code == 200
    assert detail.json()["extracted_text"].startswith("ABSTRACT")


def test_health_and_database_readiness(client):
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    readiness = client.get("/api/ready")
    assert readiness.status_code == 200
    assert readiness.json() == {"status": "ready", "database": "connected"}


def test_custom_analysis_supporting_documents_history_and_pdf_report(client, monkeypatch):
    monkeypatch.setattr(
        main_module,
        "get_settings",
        lambda: SimpleNamespace(live_ai_enabled=False),
    )
    paper_id = add_paper(client)
    document_response = client.post(
        "/api/documents/upload",
        files=[("files", ("guidelines.txt", b"Compare methods and limitations.", "text/plain"))],
    )
    assert document_response.status_code == 200
    document_id = document_response.json()["documents"][0]["id"]
    response = client.post(
        "/api/analyses",
        json={
            "prompt": "Compare the approaches.",
            "paper_ids": [paper_id],
            "document_ids": [document_id],
            "mode": "comprehensive",
            "criteria": ["methods"],
            "questions": [],
            "report_format": "detailed",
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["provider"] == "local"
    assert result["result"]["demo_mode"] is True
    assert result["result"]["research_gaps"] == []
    history = client.get("/api/analyses")
    assert history.json()["analyses"][0]["id"] == result["id"]
    detail = client.get(f"/api/analyses/{result['id']}")
    assert detail.json()["documents"][0]["id"] == document_id
    report = client.get(f"/api/analyses/{result['id']}/report")
    assert report.status_code == 200
    assert report.headers["content-type"] == "application/pdf"
    assert report.content.startswith(b"%PDF")


def test_projects_create_membership_update_and_delete_preserves_papers(client, monkeypatch):
    monkeypatch.setattr(
        main_module,
        "get_settings",
        lambda: SimpleNamespace(live_ai_enabled=False),
    )
    paper_ids = [add_paper(client), add_paper(client)]
    created = client.post(
        "/api/projects",
        json={"name": "Language evaluation", "description": "Dataset coverage"},
    )
    assert created.status_code == 200, created.text
    project_id = created.json()["id"]
    invalid_project_analysis = client.post(
        "/api/analyses",
        json={"prompt": "Analyze this paper.", "paper_ids": [paper_ids[0]], "project_id": "missing"},
    )
    assert invalid_project_analysis.status_code == 404
    saved_analysis = client.post(
        "/api/analyses",
        json={"prompt": "Analyze this paper.", "paper_ids": [paper_ids[0]], "project_id": project_id},
    )
    assert saved_analysis.status_code == 200
    assigned = client.post(
        f"/api/projects/{project_id}/papers",
        json={"paper_ids": paper_ids},
    )
    assert assigned.status_code == 200
    assert set(assigned.json()["paper_ids"]) == set(paper_ids)
    assert {paper["project_id"] for paper in client.get("/api/papers").json()["papers"]} == {project_id}

    updated = client.put(
        f"/api/projects/{project_id}",
        json={"name": "Updated project", "description": ""},
    )
    assert updated.json()["name"] == "Updated project"
    project_data = client.get("/api/projects").json()["projects"][0]
    assert set(project_data["paper_ids"]) == set(paper_ids)
    assert project_data["analysis_ids"] == [saved_analysis.json()["id"]]

    deleted = client.delete(f"/api/projects/{project_id}")
    assert deleted.status_code == 200
    assert client.get("/api/projects").json()["projects"] == []
    assert all(paper["project_id"] is None for paper in client.get("/api/papers").json()["papers"])
    assert client.get("/api/analyses").json()["analyses"][0]["id"] == saved_analysis.json()["id"]


def test_assistant_persists_owner_scoped_thread_and_requires_matching_papers(client, monkeypatch):
    paper_id = add_paper(client)
    monkeypatch.setattr(
        main_module,
        "answer_question",
        lambda question, papers, history: (
            "The study uses F1 [S1].",
            [{
                "paper_id": papers[0].id,
                "paper_title": papers[0].title,
                "page_number": 1,
                "excerpt": "The study evaluates using F1.",
            }],
        ),
    )
    response = client.post(
        "/api/assistant/chat",
        json={"question": "Which metric is used?", "paper_ids": [paper_id]},
    )
    assert response.status_code == 200, response.text
    conversation = response.json()
    assert conversation["messages"][-1]["sources"][0]["page_number"] == 1

    follow_up = client.post(
        "/api/assistant/chat",
        json={
            "question": "What does that mean?",
            "paper_ids": [paper_id],
            "conversation_id": conversation["id"],
        },
    )
    assert follow_up.status_code == 200
    assert len(follow_up.json()["messages"]) == 4
    mismatch = client.post(
        "/api/assistant/chat",
        json={
            "question": "Change the source?",
            "paper_ids": [],
            "conversation_id": conversation["id"],
        },
    )
    assert mismatch.status_code == 422
    assert client.get("/api/assistant/conversations").json()["conversations"][0]["id"] == conversation["id"]
    assert client.delete(f"/api/assistant/conversations/{conversation['id']}").status_code == 200
    assert client.get("/api/assistant/conversations").json()["conversations"] == []


def test_analysis_request_validation_and_missing_paper(client, monkeypatch):
    monkeypatch.setattr(
        main_module,
        "get_settings",
        lambda: SimpleNamespace(live_ai_enabled=False),
    )
    invalid_prompt = client.post(
        "/api/analyses",
        json={"prompt": "no", "paper_ids": ["missing"]},
    )
    assert invalid_prompt.status_code == 422
    missing_paper = client.post(
        "/api/analyses",
        json={"prompt": "Compare these works.", "paper_ids": ["missing"]},
    )
    assert missing_paper.status_code == 404


def test_provider_errors_are_reported_without_fallback(client, monkeypatch):
    paper_id = add_paper(client)
    monkeypatch.setattr(
        main_module,
        "get_settings",
        lambda: SimpleNamespace(live_ai_enabled=True),
    )

    def fail_provider(*args, **kwargs):
        raise ProviderError("Groq rate limit or quota reached. Check your usage limits and retry later.")

    monkeypatch.setattr(main_module, "live_analyze", fail_provider)
    response = client.post(
        "/api/analyses",
        json={"prompt": "Compare these works.", "paper_ids": [paper_id]},
    )
    assert response.status_code == 502
    assert response.json()["detail"] == "Groq rate limit or quota reached. Check your usage limits and retry later."
    assert client.get("/api/analyses").json()["analyses"] == []


def test_live_analysis_uses_lexical_similarity_and_stores_pairwise_similarity(client, monkeypatch):
    monkeypatch.setattr(
        main_module,
        "get_settings",
        lambda: SimpleNamespace(
            live_ai_enabled=True,
            groq_model="openai/gpt-oss-20b",
        ),
    )
    paper_ids = [add_paper(client), add_paper(client)]
    monkeypatch.setattr(
        main_module,
        "live_analyze",
        lambda *args, **kwargs: {
            "executive_summary": "Mocked structured result.",
            "paper_summaries": [],
            "research_gaps": [],
            "similarities": [],
        },
    )
    response = client.post(
        "/api/analyses",
        json={"prompt": "Compare these works.", "paper_ids": paper_ids},
    )
    assert response.status_code == 200, response.text
    similarities = response.json()["result"]["similarities"]
    assert similarities[0]["paper_ids"] == paper_ids
    assert similarities[0]["score"] == pytest.approx(1.0)
    assert similarities[0]["method"] == "lexical-overlap"


def test_google_auth_is_required_and_data_is_owner_scoped(client, monkeypatch):
    import backend.auth as auth_module

    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: SimpleNamespace(
            google_client_id="",
            allowed_google_emails="",
            auth_required=True,
        ),
    )
    assert client.get("/api/papers").status_code == 503

    monkeypatch.setattr(
        main_module,
        "get_settings",
        lambda: SimpleNamespace(live_ai_enabled=False),
    )
    users = {
        "owner-a-token": ("owner-a", "a@example.com"),
        "owner-b-token": ("owner-b", "b@example.com"),
        "blocked-token": ("blocked", "blocked@example.com"),
    }
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: SimpleNamespace(
            google_client_id="test-client",
            allowed_google_emails="a@example.com,b@example.com",
            auth_required=True,
        ),
    )
    monkeypatch.setattr(
        auth_module,
        "verify_google_id_token",
        lambda token, _client_id: {
            "sub": users[token][0],
            "email": users[token][1],
            "email_verified": True,
        },
    )

    assert client.get("/api/health").status_code == 200
    assert client.get("/api/papers").status_code == 401
    assert client.get("/api/papers", headers={"Authorization": "Bearer blocked-token"}).status_code == 403

    owner_a = {"Authorization": "Bearer owner-a-token"}
    owner_b = {"Authorization": "Bearer owner-b-token"}
    paper_a = add_paper(client, "owner-a-token")
    paper_b = add_paper(client, "owner-b-token")
    document_a = client.post(
        "/api/documents/upload",
        headers=owner_a,
        files=[("files", ("owner-a.txt", b"Owner A notes.", "text/plain"))],
    ).json()["documents"][0]["id"]
    document_b = client.post(
        "/api/documents/upload",
        headers=owner_b,
        files=[("files", ("owner-b.txt", b"Owner B notes.", "text/plain"))],
    ).json()["documents"][0]["id"]
    listed = client.get("/api/papers", headers=owner_a).json()["papers"]
    assert [paper["id"] for paper in listed] == [paper_a]
    assert [
        document["id"]
        for document in client.get("/api/documents", headers=owner_a).json()["documents"]
    ] == [document_a]
    assert client.get(f"/api/papers/{paper_b}", headers=owner_a).status_code == 404

    cross_user_analysis = client.post(
        "/api/analyses",
        headers=owner_a,
        json={"prompt": "Compare these works.", "paper_ids": [paper_b]},
    )
    assert cross_user_analysis.status_code == 404
    cross_user_document = client.post(
        "/api/analyses",
        headers=owner_a,
        json={
            "prompt": "Compare these works.",
            "paper_ids": [paper_a],
            "document_ids": [document_b],
        },
    )
    assert cross_user_document.status_code == 404

    analysis = client.post(
        "/api/analyses",
        headers=owner_a,
        json={"prompt": "Compare these works.", "paper_ids": [paper_a]},
    ).json()
    assert client.get("/api/analyses", headers=owner_b).json()["analyses"] == []
    assert client.delete(f"/api/papers/{paper_a}", headers=owner_b).status_code == 404
    assert client.get(f"/api/analyses/{analysis['id']}", headers=owner_b).status_code == 404
    assert client.get(
        f"/api/analyses/{analysis['id']}/report", headers=owner_b
    ).status_code == 404


def test_owner_migration_backfills_legacy_rows(client, monkeypatch):
    import backend.database as database_module

    legacy_engine = create_engine("sqlite://")
    with legacy_engine.begin() as connection:
        for table in ("papers", "analyses", "supporting_documents"):
            connection.execute(text(f'CREATE TABLE "{table}" (id VARCHAR(36) PRIMARY KEY)'))
            connection.execute(text(f'INSERT INTO "{table}" (id) VALUES ("legacy")'))
    monkeypatch.setattr(database_module, "engine", legacy_engine)

    database_module.migrate_owner_columns()

    with legacy_engine.connect() as connection:
        for table in ("papers", "analyses", "supporting_documents"):
            column_names = {column["name"] for column in inspect(connection).get_columns(table)}
            owner = connection.execute(
                text(f'SELECT owner_id FROM "{table}" WHERE id = "legacy"')
            ).scalar_one()
            assert "owner_id" in column_names
            assert owner == "local"
    legacy_engine.dispose()
