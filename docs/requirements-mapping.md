# Requirements checklist and source mapping

## Source note

The supplied attachment contains the ResearchLens implementation brief. No Stage 2 report, research paper, diagram, screenshot, or dataset was present in the accessible attachment/workspace. Items below map the explicit implementation brief, not uninspected report content.

## Checklist

| Brief requirement | Implementation | Status / caveat |
|---|---|---|
| Dashboard and responsive navigation | `frontend/src/App.tsx`, `frontend/src/styles.css` | Implemented |
| Paper upload, library, extraction | `backend/main.py`, `backend/services/pdf.py`, frontend Upload and Library routes | Text PDFs only; scanned OCR unsupported |
| Individual-paper analysis | `/papers/{paper_id}` API and paper detail route | Extracted text and detected sections are viewable; one-click analysis preselects the paper |
| Multiple-paper/custom comparison | `POST /api/analyses`, `backend/services/analysis.py`, `backend/services/gemini.py` | Implemented for selected papers |
| Research-gap discovery | Gemini structured prompt plus evidence validation | Requires configured Gemini key; no gaps are invented in local mode |
| Semantic similarity | Gemini embeddings and cosine similarity | Requires configured Gemini key; local mode is explicitly lexical |
| Custom prompt and mode | Custom Analysis route, `AnalysisRequest` | Implemented with prompt, criteria, questions, and report format |
| Select papers and supporting files | `frontend/src/App.tsx`, `/api/documents/upload`, `AnalysisRequest.document_ids` | PDF/TXT/Markdown/CSV support; each file capped at configured size and 200,000 extracted characters |
| Long-document context management | `backend/services/gemini.py` | Sequential source chunks and bounded context budget; excluded trailing text is disclosed |
| Prompt safety and untrusted files | `backend/services/gemini.py` system instruction and document delimiters | Provider instructions resist prompt injection; no secrets are placed in model context |
| Executive and individual summaries | Gemini result schema and result renderer | Live AI only; local mode displays extraction preview rather than fabricated summary |
| Comparison matrix, methods, dataset/results, limitations | Structured model response plus result renderer | Depends on provider response; output is not independently peer-reviewed |
| Evidence excerpts and counter-evidence | Gap schema and source-text verification | Exact extracted text match required; page numbers are intentionally omitted |
| Saved history and database persistence | SQLAlchemy `Paper`, `Analysis`, supporting-document models | Implemented in local SQLite by default |
| Downloadable report | `backend/services/reports.py` | Generates a PDF analysis report; verify source quotations in the app |
| Settings/API guidance and key security | Settings route, `.env.example`, backend config | Key is server-side only; Gemini provider implemented |
| API docs and Windows instructions | FastAPI `/docs`, `README.md` | Implemented |
| Automated tests | `backend/tests/` | Unit/API tests included; run commands in README |

## Engineering decisions where the brief left details open

- **Primary source limitation:** the Stage 2 report was not attached, so the supplied brief is used as the only requirements baseline. No project-specific architecture, ML algorithm, or UI reference is attributed to the missing report.
- **Local mode:** without an API key the app still extracts actual user PDFs and computes a visibly labeled word-frequency cosine overlap. It does not pretend this score is semantic similarity or create AI findings.
- **Provider:** Gemini is the initial provider; an OpenAI adapter was optional in the brief and is not included.
- **Supported attachments:** research papers use PDF. Optional supporting documents accept PDF, TXT, Markdown, and CSV; DOCX and spreadsheets are rejected with a clear error.
- **Evidence confidence:** only excerpts exactly found in extracted paper text are accepted; unverified gap candidates are dropped. This improves traceability but can reject valid paraphrased or hyphenated excerpts.
- **Page citations:** page metadata is not inferred from model output. Page numbers are omitted until stable page-position mapping is implemented.
- **Processing:** analysis is a synchronous API request with a visible spinner, not a background queue or detailed stage-by-stage progress stream.
- **Long inputs:** provider context per paper is bounded; this protects request size but can omit content in exceptionally long PDFs.
- **Identity and hosting:** this is a local-first single-user application with no sign-in, multi-tenant permissions, or public deployment hardening.
