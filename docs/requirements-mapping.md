# Requirements checklist and source mapping

## Source note

The supplied attachment contains the ResearchLens implementation brief. No Stage 2 report, research paper, diagram, screenshot, or dataset was present in the accessible attachment/workspace. Items below map the explicit implementation brief, not uninspected report content.

## Checklist

| Brief requirement | Implementation | Status / caveat |
|---|---|---|
| Dashboard and responsive navigation | `frontend/src/App.tsx`, `frontend/src/styles.css` | Implemented |
| Paper upload, library, extraction | `backend/main.py`, `backend/services/pdf.py`, frontend Upload and Library routes | Text PDFs only; scanned OCR unsupported |
| Individual-paper analysis | `/papers/{paper_id}` API and paper detail route | Extracted text and detected sections are viewable; one-click analysis preselects the paper |
| Multiple-paper/custom comparison | `POST /api/analyses`, `backend/services/analysis.py`, `backend/services/groq.py` | Implemented for selected papers |
| Research-gap discovery | Groq JSON prompt plus evidence validation | Requires configured Groq key; no gaps are invented in local mode |
| Text similarity | Lexical cosine similarity over word-frequency vectors | Not semantic similarity |
| Custom prompt and mode | Custom Analysis route, `AnalysisRequest` | Implemented with prompt, criteria, questions, and report format |
| Select papers and supporting files | `frontend/src/App.tsx`, `/api/documents/upload`, `AnalysisRequest.document_ids` | PDF/TXT/Markdown/CSV support; each file capped at configured size and 200,000 extracted characters |
| Long-document context management | `backend/services/groq.py` | Sequential source chunks and bounded context budget; excluded trailing text is disclosed |
| Prompt safety and untrusted files | `backend/services/groq.py` system instruction and document delimiters | Provider instructions resist prompt injection; no secrets are placed in model context |
| Executive and individual summaries | Groq JSON response and result renderer | Live AI only; local mode displays extraction preview rather than fabricated summary |
| Comparison matrix, methods, dataset/results, limitations | Structured model response plus result renderer | Depends on provider response; output is not independently peer-reviewed |
| Evidence excerpts and counter-evidence | Gap schema and source-text verification | Exact page-text match is required when page data is available; legacy papers retain unpaged verified excerpts |
| Saved history and database persistence | SQLAlchemy `Paper`, `Analysis`, supporting-document models | Implemented in local SQLite by default |
| Downloadable report | `backend/services/reports.py` | Generates a PDF analysis report; verify source quotations in the app |
| Analytics page | `AnalyticsPage` in `frontend/src/App.tsx` | Visualizes saved analysis counts, extracted methodology signals, evidence mentions, and recorded similarity pairs only |
| Research assistant | `/api/assistant/chat`, `answer_question`, and `AssistantPage` | Requires Groq; retrieves selected-paper text chunks lexically, includes source excerpts, and keeps owner-scoped conversations |
| Research projects | `/api/projects`, `Project`, and `ProjectsPage` | Groups owned papers and explicitly assigned analyses; deleting a project unassigns rather than deletes its contents |
| Report center | `ReportsPage` | PDF, escaped HTML, and available comparison CSV downloads from saved analyses |
| Settings page | `SettingsPage` | Shows account and backend state, privacy/data behavior, and server-side configuration guidance; secrets remain uneditable in the browser |
| Dedicated comparison page | `/compare` route | Reuses the existing multi-paper analysis pipeline; no separate duplicate comparison engine |
| Settings/API guidance and key security | Settings route, `.env.example`, backend config | Key is server-side only; Groq provider implemented |
| API docs and Windows instructions | FastAPI `/docs`, `README.md` | Implemented |
| Automated tests | `backend/tests/` | Unit/API tests included; run commands in README |

## Engineering decisions where the brief left details open

- **Primary source limitation:** the Stage 2 report was not attached, so the supplied brief is used as the only requirements baseline. No project-specific architecture, ML algorithm, or UI reference is attributed to the missing report.
- **Local mode:** without an API key the app still extracts actual user PDFs and computes a visibly labeled word-frequency cosine overlap. It does not pretend this score is semantic similarity or create AI findings.
- **Provider:** Groq chat completions provide live AI; model availability and rate limits depend on the account.
- **Supported attachments:** research papers use PDF. Optional supporting documents accept PDF, TXT, Markdown, and CSV; DOCX and spreadsheets are rejected with a clear error.
- **Evidence confidence:** only excerpts exactly found in extracted paper text are accepted; unverified gap candidates are dropped. This improves traceability but can reject valid paraphrased or hyphenated excerpts.
- **Page citations:** uploads retain normalized text per PDF page. Evidence excerpts are checked against each page and receive a page number from stored extraction metadata, never from model output. Existing stored papers without page metadata continue to show verified, unpaged evidence.
- **Processing:** analysis is a synchronous API request with a visible spinner, not a background queue or detailed stage-by-stage progress stream.
- **Long inputs:** provider context per paper is bounded; this protects request size but can omit content in exceptionally long PDFs.
- **Identity and hosting:** Google sign-in and email allowlisting provide owner-scoped API access when configured; local mode remains a trusted single-user deployment.
- **Assistant retrieval:** retrieval currently uses lexical token overlap rather than a persisted vector index. Groq is required to generate answers; local mode will not fabricate assistant responses.
