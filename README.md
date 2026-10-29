# ResearchLens

ResearchLens is a research-paper analysis app that runs locally or as a cloud service. It extracts text from uploaded PDFs, lets you define custom analysis prompts, compares selected papers, and (when configured) uses Groq for evidence-grounded summaries and candidate research-gap discovery.


## What is implemented

- React, Vite, TypeScript, Tailwind CSS, React Router, Recharts, and Lucide UI.
- FastAPI REST API, SQLAlchemy persistence with SQLite locally/PostgreSQL in the cloud, and interactive API docs.
- Multi-PDF upload, validation, text extraction, basic section detection, searchable paper library, and deletion.
- Individual paper detail view with detected sections and extracted text preview.
- Custom prompt, selected papers, optional PDF/TXT/Markdown/CSV supporting files, custom criteria, domain questions, analysis mode, and report format.
- Groq Python SDK integration for JSON-formatted analysis and paper-grounded assistant answers. Evidence excerpts are checked against source text before gaps are kept.
- Local demo mode when no API key is configured. It extracts actual uploaded text and reports lexical overlap only; it does not invent AI summaries or research gaps.
- Saved analysis history, similarity heatmap, comparison CSV export, and downloadable PDF reports.
- Dedicated analytics, multi-paper comparison, project workspace, reports, and settings pages.
- A dedicated Research Gaps page that filters saved evidence-linked candidates, surfaces confidence and supporting passages, and summarizes research directions across analyses.
- Prompt starters for comprehensive literature reviews, method/result comparisons, and evidence-based gap discovery; each page has a distinct visual theme.
- A paper-grounded Research Assistant with retrieved page excerpts, source citations, and persistent per-account conversations (requires the configured Groq service).
- Project membership for papers and saved analyses, with owner-scoped project APIs.
- Optional Google sign-in with server-side email allowlisting and per-account data isolation.
- Tests for PDF handling, preprocessing, similarity, evidence validation, API validation, provider errors, persistence, supporting documents, and reports.

## Windows setup

Requirements: Python 3.10+ (Python 3.11 or 3.12 recommended) and Node.js 20+.

In PowerShell, from the project root:

```powershell
py -3.11 -m venv .venv311
.\.venv311\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
```

For live AI, create a Groq API key and add it to `.env`:

```dotenv
GROQ_API_KEY=your_key_here
```

The key is used only by the backend. Do not commit `.env`. You can start the app without a key; local extraction and lexical overlap remain available.
Keep the key private. If it is ever exposed, revoke it in the Groq console and update only the backend environment.

For local Google sign-in, set `GOOGLE_CLIENT_ID` and `ALLOWED_GOOGLE_EMAILS` in the root `.env`, set `VITE_GOOGLE_CLIENT_ID` in `frontend/.env.local`, and set the Google OAuth authorized JavaScript origin to `http://localhost:5173`. The frontend's development API URL defaults to localhost and does not need an environment variable.

Open **two PowerShell terminals**, both at the project root.

Terminal 1 — backend:

```powershell
.\.venv311\Scripts\Activate.ps1
python -m backend
```

Terminal 2 — frontend:

```powershell
Set-Location .\frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). FastAPI interactive documentation is at [http://localhost:8000/docs](http://localhost:8000/docs), and the health endpoint is [http://localhost:8000/api/health](http://localhost:8000/api/health).

If PowerShell blocks virtual environment activation, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in that terminal and activate again.
If an existing environment fails while importing Pydantic or `pydantic_core`, stop the server and create a clean Python 3.11 or 3.12 virtual environment rather than reusing the broken environment.

## Free cloud deployment (Vercel + Render + Supabase)

Deploy the React/Vite frontend on Vercel and the FastAPI backend on Render. The root [render.yaml](render.yaml) defines only the API service. Use Supabase Postgres for persistent cloud metadata, extracted paper text, and analysis history. Render's free service filesystem is temporary, so the app does not retain uploaded PDF binaries: it extracts text during upload, saves that text and metadata in Postgres, then discards the original file. Re-upload a PDF if it needs to be extracted again.

This free-tier setup is for evaluation, not a production availability or confidentiality guarantee. Render may sleep an idle service; Supabase free projects have resource limits and may pause after inactivity; Groq has account-specific rate limits and terms that can change. Check current provider terms and pricing, keep backups, and don't upload material you aren't permitted to process with third-party services.

### 1. Push the project to GitHub

Create a **private** GitHub repository, then add and push the project. Check that `.env`, `.env.local`, virtual environments, `node_modules`, generated builds, databases, and research papers are not committed. The root `.gitignore` excludes environment files except `.env.example`.

### 2. Create persistent Postgres

Create a Supabase project on its free plan. In **Project Settings → Database**, copy a Postgres connection URI that works for external clients, such as the session pooler URI. Keep its password private. Render will use it as `DATABASE_URL`; use a `postgresql://...` URI, which the backend adapts to its psycopg driver.

At startup, SQLAlchemy creates missing tables and adds `owner_id` columns to older schemas. Existing local rows remain assigned to the `local` account; this setup does not import local database contents. Back up important data before changing or resetting the database.

### 3. Configure Google sign-in

In Google Cloud Console, configure the OAuth consent screen and create an OAuth **Web application** client ID. Add allowed accounts as test users if the consent screen is in testing. After Vercel creates the frontend domain, add that exact HTTPS origin under authorized JavaScript origins. The backend additionally checks `ALLOWED_GOOGLE_EMAILS`, so only listed accounts can access data.

### 4. Deploy the API to Render

In Render, create a **New → Blueprint** from your GitHub repository and select the root `render.yaml`. The Blueprint creates the `researchlens-api` service, installs `requirements.txt`, listens on Render's `$PORT`, and checks `/api/ready`, which verifies the database connection.

Set these values in the API's Render environment:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Private Supabase Postgres connection URI |
| `AUTH_REQUIRED` | `true` (set by the Blueprint) |
| `GOOGLE_CLIENT_ID` | Google OAuth Web client ID |
| `ALLOWED_GOOGLE_EMAILS` | Comma-separated approved account email addresses |
| `FRONTEND_ORIGIN` | Exact Vercel production origin, e.g. `https://your-project.vercel.app` |
| `GROQ_API_KEY` | Groq key (private); may be empty for labeled local mode |

Use the API URL actually assigned in Render; this repository does not create a service or assume its URL.

### 5. Deploy the frontend to Vercel

In Vercel, import the GitHub repository and set **Root Directory** to `frontend`. Use build command `npm run build`, output directory `dist`, and install command `npm ci`; Vercel should detect Vite. Add Production environment variables:

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | Actual Render API URL ending in `/api`, e.g. `https://your-api.onrender.com/api` |
| `VITE_GOOGLE_CLIENT_ID` | Same Google OAuth Web client ID (public identifier only) |

The SPA rewrite in [frontend/vercel.json](frontend/vercel.json) sends client routes to `index.html`. Once the Vercel domain is known, set its exact origin in Render's `FRONTEND_ORIGIN` and Google OAuth's authorized JavaScript origins. Redeploy API after changing CORS, and rebuild the frontend after changing Vercel environment variables. Preview domains are separate origins; configure preview CORS if testing previews.

### 6. Verify and redeploy

Visit `/api/health` and `/api/ready` on the actual Render service. Readiness should return `{"status":"ready","database":"connected"}`. Open the Vercel production site, sign in as an allowlisted account, upload a text-based PDF, run an analysis, and reopen it from history. Live AI testing requires a valid Groq key and available quota. No deployment or public URL is created by these code changes.

The Groq API key and Postgres URI are backend-only secrets. Never use them in `VITE_` variables, commit them, or include them in screenshots. After code changes, push to GitHub; connected Render and Vercel projects can redeploy from the configured branch or be manually deployed from their dashboards.

Provider references: [Groq API keys](https://console.groq.com/keys), [Groq models](https://console.groq.com/docs/models), [Groq rate limits](https://console.groq.com/docs/rate-limits), [Vercel Vite deployment](https://vercel.com/docs/frameworks/frontend/vite), and [Render docs](https://render.com/docs).

## Analysis workflow

1. Add text-based research PDFs in **Upload papers**. PDF files are limited to 25 MB, 300 pages, and 10 files per upload. Scanned image PDFs are rejected because OCR is not included.
2. Optionally upload supporting PDF, TXT, Markdown, or CSV files within **Custom analysis**.
3. Select research papers and supporting files, write a prompt, set analysis criteria and questions, select an analysis mode and report format, then review the request.
4. Run the analysis. Groq mode produces paper summaries, comparison findings, lexical similarity, potential evidence-linked gaps, and questions. Local mode shows extraction previews and explicitly labeled lexical similarity, with no AI gap claims.
5. Inspect saved results in **Analysis history**, open **Analytics** for saved-data charts, expand evidence passages, and export from **Reports** as PDF, HTML, or comparison CSV.
6. Use **Compare papers** for a dedicated multi-paper workflow, or ask selected-paper questions in **Research assistant**. Chat is unavailable without a backend Groq key; no fabricated local answers are shown.
7. Create **Projects**, assign papers, and choose a project when saving a new analysis. Existing projects and chats are private to the authenticated owner when Google sign-in is enabled.

Research gaps are candidates based only on the selected materials, not claims of worldwide novelty. New uploads retain normalized text per PDF page; cited excerpts are verified against that page and the page number is derived from stored extraction metadata, never trusted from the AI response. Older papers uploaded before page-aware extraction may have verified excerpts without page numbers.

## API overview

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Provider and service status |
| `GET` | `/api/ready` | Database readiness check |
| `GET` | `/api/me` | Verify sign-in and return the current account |
| `GET`, `POST` | `/api/projects` | List or create projects |
| `PUT`, `DELETE` | `/api/projects/{project_id}` | Update or delete a project |
| `POST` | `/api/projects/{project_id}/papers` | Set project paper membership |
| `GET` | `/api/assistant/conversations` | List saved assistant conversations |
| `POST` | `/api/assistant/chat` | Retrieve paper excerpts and ask a grounded assistant question |
| `DELETE` | `/api/assistant/conversations/{conversation_id}` | Delete a saved conversation |
| `POST` | `/api/papers/upload` | Upload and extract PDF papers |
| `GET` | `/api/papers` | List library papers |
| `GET` | `/api/papers/{paper_id}` | Read one paper and extracted text |
| `DELETE` | `/api/papers/{paper_id}` | Remove a paper |
| `POST` | `/api/documents/upload` | Upload optional supporting documents |
| `GET` | `/api/documents` | List supporting documents |
| `POST` | `/api/analyses` | Analyze selected papers and documents |
| `GET` | `/api/analyses` | List saved analysis sessions |
| `GET` | `/api/analyses/{analysis_id}` | Read saved results and sources |
| `GET` | `/api/analyses/{analysis_id}/report` | Download a PDF report |

Existing databases are upgraded at startup with nullable project-link columns. New `projects` and `assistant_conversations` tables are created automatically. Deleting a project unassigns its papers and analyses; it does not delete them. Deleting a chat removes its stored conversation messages and source excerpts.

## Tests and build

Backend tests:

```powershell
.\.venv311\Scripts\Activate.ps1
python -m pytest backend\tests -q
```

Frontend production build:

```powershell
Set-Location .\frontend
npm run build
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `GROQ_API_KEY` | empty | Server-side Groq API key; empty enables local mode |
| `GROQ_MODEL` | `openai/gpt-oss-20b` | Groq chat-completion model; verify it is available to your account |
| `GOOGLE_CLIENT_ID` | empty | Server-side Google token audience; enables Google sign-in |
| `ALLOWED_GOOGLE_EMAILS` | empty | Comma-separated email allowlist required when Google sign-in is enabled |
| `AUTH_REQUIRED` | `false` | Require Google sign-in; set to `true` for cloud deployments |
| `DATABASE_URL` | `sqlite:///./researchlens.db` | SQLAlchemy database URL |
| `MAX_UPLOAD_MB` | `25` | Maximum size per uploaded file |
| `MAX_FILES_PER_UPLOAD` | `10` | Maximum files per upload request |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Allowed browser origin |
| `VITE_API_BASE_URL` | `http://localhost:8000/api` in development; required in production | Frontend API base URL |
| `VITE_GOOGLE_CLIENT_ID` | empty | Public Google OAuth client identifier |

Backend variables go in the project-root `.env` locally and in the Render API service environment in the cloud. `VITE_API_BASE_URL` and `VITE_GOOGLE_CLIENT_ID` are frontend build-time variables: set them in `frontend/.env.local` locally or in Vercel's project environment. The `.env.example` files contain placeholders only.

## Algorithm and provider notes

- PDF text is extracted using PyMuPDF, whitespace and line-break hyphenation are normalized, and headings are heuristically mapped to abstract, objectives, methodology, datasets, results, limitations, conclusion, and future work.
- In local mode, a token-frequency cosine score measures lexical word overlap. It is not semantic similarity.
- With a Groq key, the backend requests JSON-formatted analyses and grounded assistant responses. Pairwise paper similarity uses lexical word-frequency vectors; Groq embeddings are not used. Transient errors are retried in a bounded manner and reported to the UI rather than replaced with successful-looking mock results.
- Extracted files and prompt content are treated as untrusted data. A fixed system instruction tells the model to ignore instructions embedded in supplied documents. Evidence quotations from gap candidates must match extracted source text; unverified gaps are removed.
- Groq is the configured live provider. Provider keys and model names remain server-side.

## Limitations and troubleshooting

- OCR, DOCX, spreadsheets, external literature search, editable metadata, automatic author/keyword/reference extraction, and background job progress tracking are not included. Google authentication is optional; without it, local mode is intended for a trusted single-user environment only.
- Very long source text is divided into sequential chunks, with a bounded per-analysis context budget; truncated coverage is explicitly disclosed to the model. This is not a full-document guarantee. Review source coverage for long papers.
- Page numbers are available for verified evidence excerpts from papers uploaded after page-aware extraction was added; older stored papers retain evidence without page numbers.
- Assistant retrieval uses local lexical matching over page text before sending only the selected excerpts and short conversation history to Groq; it is not a vector-indexed or external-literature search system.
- If the UI cannot connect, confirm that the backend is running on port 8000. If CORS errors occur, set `FRONTEND_ORIGIN` to the Vite origin and restart the backend.
- If Groq is unavailable, check the key, model availability, network access, API rate limits, and the backend console. Provider failures are surfaced in the UI.
- The local SQLite database is created in the backend process's current working directory and ignored by Git. In cloud deployment, use persistent external PostgreSQL and set `AUTH_REQUIRED=true`.
