import logging
from datetime import timezone
from urllib.parse import quote

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlalchemy import desc, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.auth import UserIdentity, get_current_user
from backend.config import get_settings
from backend.database import Base, engine, get_db, migrate_owner_columns
from backend.models import (
    Analysis,
    AnalysisDocument,
    AnalysisPaper,
    AssistantConversation,
    Paper,
    Project,
    SupportingDocument,
    utc_now,
)
from backend.schemas import (
    AnalysisRequest,
    AssistantRequest,
    HealthResponse,
    ProjectPapersRequest,
    ProjectRequest,
)
from backend.services.analysis import (
    build_local_analysis,
    cosine_similarity,
)
from backend.services.gemini import (
    ProviderError,
    analyze as live_analyze,
    answer_question,
    embed,
)
from backend.services.pdf import (
    PDFValidationError,
    extract_pdf,
    extract_pdf_pages,
    extract_sections,
    infer_title,
)
from backend.services.reports import create_report

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("researchlens")

settings = get_settings()
migrate_owner_columns()
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="ResearchLens API",
    description="Evidence-grounded research paper analysis and comparison",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)


def _iso(value):
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _paper_data(paper: Paper) -> dict:
    return {
        "id": paper.id,
        "filename": paper.filename,
        "title": paper.title,
        "authors": paper.authors,
        "page_count": paper.page_count,
        "word_count": paper.word_count,
        "sections": paper.sections,
        "project_id": paper.project_id,
        "created_at": _iso(paper.created_at),
    }


def _document_data(document: SupportingDocument) -> dict:
    return {
        "id": document.id,
        "filename": document.filename,
        "word_count": document.word_count,
        "created_at": _iso(document.created_at),
    }


def _analysis_data(analysis: Analysis) -> dict:
    return {
        "id": analysis.id,
        "prompt": analysis.prompt,
        "mode": analysis.mode,
        "provider": analysis.provider,
        "result": analysis.result,
        "created_at": _iso(analysis.created_at),
    }


def _project_data(project: Project, paper_ids: list[str], analysis_ids: list[str] | None = None) -> dict:
    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "paper_ids": paper_ids,
        "analysis_ids": analysis_ids or [],
        "created_at": _iso(project.created_at),
    }


def _conversation_data(conversation: AssistantConversation) -> dict:
    return {
        "id": conversation.id,
        "title": conversation.title,
        "paper_ids": conversation.paper_ids,
        "messages": conversation.messages,
        "created_at": _iso(conversation.created_at),
        "updated_at": _iso(conversation.updated_at),
    }


@app.get("/api/health", response_model=HealthResponse)
def health():
    live = get_settings().live_ai_enabled
    return {"status": "ok", "live_ai_enabled": live, "provider": "gemini" if live else "local demo"}


@app.get("/api/ready")
def readiness():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        logger.error("Database readiness check failed.")
        raise HTTPException(status_code=503, detail="Database is unavailable.") from exc
    return {"status": "ready", "database": "connected"}


@app.get("/api/me")
def current_user(user: UserIdentity = Depends(get_current_user)):
    return {"email": user.email}


@app.get("/api/projects")
def list_projects(db: Session = Depends(get_db), user: UserIdentity = Depends(get_current_user)):
    projects = db.scalars(
        select(Project).where(Project.owner_id == user.user_id).order_by(desc(Project.created_at))
    ).all()
    papers = db.scalars(select(Paper).where(Paper.owner_id == user.user_id)).all()
    analyses = db.scalars(select(Analysis).where(Analysis.owner_id == user.user_id)).all()
    paper_ids_by_project: dict[str, list[str]] = {}
    analysis_ids_by_project: dict[str, list[str]] = {}
    for paper in papers:
        if paper.project_id:
            paper_ids_by_project.setdefault(paper.project_id, []).append(paper.id)
    for analysis in analyses:
        if analysis.project_id:
            analysis_ids_by_project.setdefault(analysis.project_id, []).append(analysis.id)
    return {
        "projects": [
            _project_data(
                project,
                paper_ids_by_project.get(project.id, []),
                analysis_ids_by_project.get(project.id, []),
            )
            for project in projects
        ]
    }


@app.post("/api/projects")
def create_project(
    request: ProjectRequest,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
):
    project = Project(
        owner_id=user.user_id,
        name=request.name.strip(),
        description=request.description.strip(),
    )
    if not project.name:
        raise HTTPException(status_code=422, detail="Project name cannot be blank.")
    db.add(project)
    db.commit()
    db.refresh(project)
    return _project_data(project, [])


@app.put("/api/projects/{project_id}")
def update_project(
    project_id: str,
    request: ProjectRequest,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
):
    project = db.scalar(
        select(Project).where(Project.id == project_id, Project.owner_id == user.user_id)
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    project.name = request.name.strip()
    project.description = request.description.strip()
    if not project.name:
        raise HTTPException(status_code=422, detail="Project name cannot be blank.")
    db.commit()
    papers = db.scalars(
        select(Paper).where(Paper.owner_id == user.user_id, Paper.project_id == project.id)
    ).all()
    analyses = db.scalars(
        select(Analysis).where(Analysis.owner_id == user.user_id, Analysis.project_id == project.id)
    ).all()
    return _project_data(project, [paper.id for paper in papers], [analysis.id for analysis in analyses])


@app.post("/api/projects/{project_id}/papers")
def assign_project_papers(
    project_id: str,
    request: ProjectPapersRequest,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
):
    project = db.scalar(
        select(Project).where(Project.id == project_id, Project.owner_id == user.user_id)
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    if len(set(request.paper_ids)) != len(request.paper_ids):
        raise HTTPException(status_code=422, detail="Select each paper only once.")
    papers = db.scalars(
        select(Paper).where(Paper.owner_id == user.user_id, Paper.id.in_(request.paper_ids))
    ).all() if request.paper_ids else []
    if len(papers) != len(request.paper_ids):
        raise HTTPException(status_code=404, detail="One or more papers were not found.")
    current = db.scalars(
        select(Paper).where(Paper.owner_id == user.user_id, Paper.project_id == project.id)
    ).all()
    for paper in current:
        paper.project_id = None
    for paper in papers:
        paper.project_id = project.id
    db.commit()
    return _project_data(project, [paper.id for paper in papers])


@app.delete("/api/projects/{project_id}")
def delete_project(
    project_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
):
    project = db.scalar(
        select(Project).where(Project.id == project_id, Project.owner_id == user.user_id)
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    papers = db.scalars(
        select(Paper).where(Paper.owner_id == user.user_id, Paper.project_id == project.id)
    ).all()
    for paper in papers:
        paper.project_id = None
    analyses = db.scalars(
        select(Analysis).where(Analysis.owner_id == user.user_id, Analysis.project_id == project.id)
    ).all()
    for analysis in analyses:
        analysis.project_id = None
    db.delete(project)
    db.commit()
    return {"deleted": project_id}


@app.get("/api/assistant/conversations")
def list_assistant_conversations(
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
):
    conversations = db.scalars(
        select(AssistantConversation)
        .where(AssistantConversation.owner_id == user.user_id)
        .order_by(desc(AssistantConversation.updated_at))
        .limit(50)
    ).all()
    return {"conversations": [_conversation_data(item) for item in conversations]}


@app.post("/api/assistant/chat")
def assistant_chat(
    request: AssistantRequest,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
):
    if len(set(request.paper_ids)) != len(request.paper_ids):
        raise HTTPException(status_code=422, detail="Select each paper only once.")
    paper_by_id = {
        paper.id: paper
        for paper in db.scalars(
            select(Paper).where(Paper.owner_id == user.user_id, Paper.id.in_(request.paper_ids))
        ).all()
    }
    if len(paper_by_id) != len(request.paper_ids):
        raise HTTPException(status_code=404, detail="One or more selected papers were not found.")
    papers = [paper_by_id[paper_id] for paper_id in request.paper_ids]

    conversation = None
    if request.conversation_id:
        conversation = db.scalar(
            select(AssistantConversation).where(
                AssistantConversation.id == request.conversation_id,
                AssistantConversation.owner_id == user.user_id,
            )
        )
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        if conversation.paper_ids != request.paper_ids:
            raise HTTPException(
                status_code=422,
                detail="The selected papers must match the existing conversation.",
            )
    history = conversation.messages if conversation else []
    try:
        answer, sources = answer_question(request.question, papers, history)
    except ProviderError as exc:
        logger.warning("Research assistant request could not be completed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    messages = [
        *history,
        {"role": "user", "content": request.question},
        {"role": "assistant", "content": answer, "sources": sources},
    ][-40:]
    if conversation is None:
        conversation = AssistantConversation(
            owner_id=user.user_id,
            title=request.question[:120],
            paper_ids=request.paper_ids,
            messages=messages,
        )
        db.add(conversation)
    else:
        conversation.messages = messages
        conversation.updated_at = utc_now()
    db.commit()
    db.refresh(conversation)
    return _conversation_data(conversation)


@app.delete("/api/assistant/conversations/{conversation_id}")
def delete_assistant_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
):
    conversation = db.scalar(
        select(AssistantConversation).where(
            AssistantConversation.id == conversation_id,
            AssistantConversation.owner_id == user.user_id,
        )
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    db.delete(conversation)
    db.commit()
    return {"deleted": conversation_id}


@app.post("/api/papers/upload")
async def upload_papers(
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
):
    if not files:
        raise HTTPException(status_code=400, detail="Select at least one PDF.")
    if len(files) > settings.max_files_per_upload:
        raise HTTPException(
            status_code=413,
            detail=f"Upload no more than {settings.max_files_per_upload} files at once.",
        )
    max_size = settings.max_upload_mb * 1024 * 1024
    uploaded = []
    for file in files:
        filename = file.filename or "unnamed.pdf"
        if not filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=415, detail=f"{filename}: only PDF files are supported.")
        data = await file.read(max_size + 1)
        if len(data) > max_size:
            raise HTTPException(
                status_code=413,
                detail=f"{filename} exceeds the {settings.max_upload_mb} MB file size limit.",
            )
        try:
            page_texts, page_count = extract_pdf_pages(data, filename)
        except PDFValidationError as exc:
            raise HTTPException(status_code=422, detail=f"{filename}: {exc}") from exc
        text = "\n".join(page_texts)
        paper = Paper(
            owner_id=user.user_id,
            filename=filename[:255],
            title=infer_title(text, filename)[:500],
            page_count=page_count,
            word_count=len(text.split()),
            extracted_text=text,
            page_texts=page_texts,
            sections=extract_sections(text),
        )
        db.add(paper)
        uploaded.append(paper)
    db.commit()
    for paper in uploaded:
        db.refresh(paper)
    return {"papers": [_paper_data(paper) for paper in uploaded]}


@app.get("/api/papers")
def list_papers(db: Session = Depends(get_db), user: UserIdentity = Depends(get_current_user)):
    papers = db.scalars(
        select(Paper).where(Paper.owner_id == user.user_id).order_by(desc(Paper.created_at))
    ).all()
    return {"papers": [_paper_data(paper) for paper in papers]}


@app.post("/api/documents/upload")
async def upload_documents(
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
):
    supported_extensions = {".pdf", ".txt", ".md", ".csv"}
    if not files:
        raise HTTPException(status_code=400, detail="Select at least one supporting document.")
    if len(files) > settings.max_files_per_upload:
        raise HTTPException(
            status_code=413,
            detail=f"Upload no more than {settings.max_files_per_upload} supporting files at once.",
        )
    max_size = settings.max_upload_mb * 1024 * 1024
    uploaded = []
    for file in files:
        filename = file.filename or "unnamed"
        extension = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if extension not in supported_extensions:
            raise HTTPException(
                status_code=415,
                detail=f"{filename}: use a PDF, TXT, Markdown, or CSV supporting file.",
            )
        data = await file.read(max_size + 1)
        if len(data) > max_size:
            raise HTTPException(
                status_code=413,
                detail=f"{filename} exceeds the {settings.max_upload_mb} MB file size limit.",
            )
        try:
            if extension == ".pdf":
                content, _ = extract_pdf(data, filename)
            else:
                content = data.decode("utf-8-sig").strip()
                if "\x00" in content:
                    raise ValueError("The text file contains unsupported binary data.")
        except (PDFValidationError, UnicodeDecodeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=f"{filename}: {exc}") from exc
        if not content:
            raise HTTPException(status_code=422, detail=f"{filename}: the document is empty.")
        if len(content) > 200_000:
            raise HTTPException(
                status_code=413,
                detail=f"{filename} contains too much text. Supporting documents are limited to 200,000 characters.",
            )
        document = SupportingDocument(
            owner_id=user.user_id,
            filename=filename[:255], content=content, word_count=len(content.split())
        )
        db.add(document)
        uploaded.append(document)
    db.commit()
    for document in uploaded:
        db.refresh(document)
    return {"documents": [_document_data(document) for document in uploaded]}


@app.get("/api/documents")
def list_documents(db: Session = Depends(get_db), user: UserIdentity = Depends(get_current_user)):
    documents = db.scalars(
        select(SupportingDocument)
        .where(SupportingDocument.owner_id == user.user_id)
        .order_by(desc(SupportingDocument.created_at))
    ).all()
    return {"documents": [_document_data(document) for document in documents]}


@app.get("/api/papers/{paper_id}")
def get_paper(
    paper_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
):
    paper = db.scalar(
        select(Paper).where(Paper.id == paper_id, Paper.owner_id == user.user_id)
    )
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found.")
    return {**_paper_data(paper), "extracted_text": paper.extracted_text}


@app.delete("/api/papers/{paper_id}")
def delete_paper(
    paper_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
):
    paper = db.scalar(
        select(Paper).where(Paper.id == paper_id, Paper.owner_id == user.user_id)
    )
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found.")
    db.delete(paper)
    db.commit()
    return {"deleted": paper_id}


@app.post("/api/analyses")
def create_analysis(
    request: AnalysisRequest,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
):
    if len(set(request.paper_ids)) != len(request.paper_ids):
        raise HTTPException(status_code=422, detail="Select each paper only once.")
    project = None
    if request.project_id:
        project = db.scalar(
            select(Project).where(
                Project.id == request.project_id,
                Project.owner_id == user.user_id,
            )
        )
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found.")
    papers = db.scalars(
        select(Paper).where(
            Paper.id.in_(request.paper_ids), Paper.owner_id == user.user_id
        )
    ).all()
    paper_by_id = {paper.id: paper for paper in papers}
    if len(paper_by_id) != len(request.paper_ids):
        raise HTTPException(status_code=404, detail="One or more selected papers were not found.")
    papers = [paper_by_id[paper_id] for paper_id in request.paper_ids]
    if len(set(request.document_ids)) != len(request.document_ids):
        raise HTTPException(status_code=422, detail="Select each supporting document only once.")
    documents = (
        db.scalars(
            select(SupportingDocument).where(
                SupportingDocument.id.in_(request.document_ids),
                SupportingDocument.owner_id == user.user_id,
            )
        ).all()
        if request.document_ids
        else []
    )
    document_by_id = {document.id: document for document in documents}
    if len(document_by_id) != len(request.document_ids):
        raise HTTPException(status_code=404, detail="One or more supporting documents were not found.")
    documents = [document_by_id[document_id] for document_id in request.document_ids]
    if len(request.prompt) > 4000:
        raise HTTPException(status_code=422, detail="Prompt exceeds the 4,000-character limit.")

    provider = "local"
    if get_settings().live_ai_enabled:
        try:
            result = live_analyze(
                papers,
                request.prompt,
                request.mode,
                request.criteria,
                request.questions,
                request.report_format,
                documents,
            )
            vectors = [
                embed(f"{paper.title}\n{paper.extracted_text}")
                for paper in papers
            ]
        except ProviderError as exc:
            logger.warning("AI analysis could not be completed: %s", exc)
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        provider = "gemini"
        comparisons = []
        for index, first in enumerate(papers):
            for other_index in range(index + 1, len(papers)):
                second = papers[other_index]
                score = cosine_similarity(vectors[index], vectors[other_index])
                comparisons.append(
                    {
                        "paper_ids": [first.id, second.id],
                        "paper_titles": [first.title, second.title],
                        "score": round(score, 4),
                        "method": get_settings().gemini_embedding_model,
                        "explanation": "Cosine similarity between provider-generated paper embeddings.",
                    }
                )
        result["similarities"] = comparisons
    else:
        result, _ = build_local_analysis(
            papers, request.prompt, request.mode, request.criteria, request.questions
        )

    result["papers_analyzed"] = [
        {"paper_id": paper.id, "title": paper.title} for paper in papers
    ]
    result["supporting_documents"] = [
        {"document_id": document.id, "filename": document.filename}
        for document in documents
    ]
    analysis = Analysis(
        owner_id=user.user_id,
        prompt=request.prompt,
        mode=request.mode,
        project_id=project.id if project else None,
        criteria=request.criteria,
        result=result,
        provider=provider,
    )
    db.add(analysis)
    db.flush()
    for paper in papers:
        db.add(AnalysisPaper(analysis_id=analysis.id, paper_id=paper.id))
    for document in documents:
        db.add(AnalysisDocument(analysis_id=analysis.id, document_id=document.id))
    db.commit()
    db.refresh(analysis)
    return _analysis_data(analysis)


@app.get("/api/analyses")
def list_analyses(db: Session = Depends(get_db), user: UserIdentity = Depends(get_current_user)):
    analyses = db.scalars(
        select(Analysis)
        .where(Analysis.owner_id == user.user_id)
        .order_by(desc(Analysis.created_at))
        .limit(100)
    ).all()
    return {"analyses": [_analysis_data(analysis) for analysis in analyses]}


@app.get("/api/analyses/{analysis_id}")
def get_analysis(
    analysis_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
):
    analysis = db.scalar(
        select(Analysis).where(
            Analysis.id == analysis_id, Analysis.owner_id == user.user_id
        )
    )
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    papers = [link.paper for link in analysis.paper_links]
    documents = [link.document for link in analysis.document_links]
    return {
        **_analysis_data(analysis),
        "papers": [_paper_data(paper) for paper in papers],
        "documents": [_document_data(document) for document in documents],
    }


@app.get("/api/analyses/{analysis_id}/report")
def download_report(
    analysis_id: str,
    db: Session = Depends(get_db),
    user: UserIdentity = Depends(get_current_user),
):
    analysis = db.scalar(
        select(Analysis).where(
            Analysis.id == analysis_id, Analysis.owner_id == user.user_id
        )
    )
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    content = create_report(analysis)
    filename = f"researchlens-{analysis.id[:8]}.pdf"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )
