import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom'
import {
  Activity, ArrowDownToLine, ArrowRight, BookOpen, ChartNoAxesCombined, Check,
  ChevronDown, CircleHelp, Clock3, FilePlus2, FileText, FlaskConical, FolderOpen,
  Gauge, LayoutDashboard, Menu, Search, Settings, ShieldCheck, Sparkles, Upload, X,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, setAuthToken, type Analysis, type Paper, type SupportingDocument } from './api'
import './styles.css'

type ToastState = { message: string; kind: 'success' | 'error' } | null

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string
            callback: (response: { credential: string }) => void
          }) => void
          renderButton: (element: HTMLElement, options: Record<string, string>) => void
          disableAutoSelect: () => void
        }
      }
    }
  }
}

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || ''
let googleIdentityScript: Promise<void> | undefined

function loadGoogleIdentityScript() {
  if (window.google?.accounts) return Promise.resolve()
  if (!googleIdentityScript) {
    googleIdentityScript = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Could not load Google sign-in. Check your network connection.'))
      document.head.appendChild(script)
    })
  }
  return googleIdentityScript
}

function App() {
  const [papers, setPapers] = useState<Paper[]>([])
  const [documents, setDocuments] = useState<SupportingDocument[]>([])
  const [analyses, setAnalyses] = useState<Analysis[]>([])
  const [aiEnabled, setAiEnabled] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [authToken, setAuthTokenState] = useState<string | null>(() => sessionStorage.getItem('researchlens.googleToken'))
  const [userEmail, setUserEmail] = useState('')
  const [authError, setAuthError] = useState('')
  const googleButton = useRef<HTMLDivElement>(null)
  const location = useLocation()

  const refresh = useCallback(async () => {
    const [paperList, documentList, analysisList, health] = await Promise.all([
      api.papers(), api.documents(), api.analyses(), api.health(),
    ])
    setPapers(paperList)
    setDocuments(documentList)
    setAnalyses(analysisList)
    setAiEnabled(health.live_ai_enabled)
  }, [])

  useEffect(() => {
    if (!googleClientId || authToken) return
    let cancelled = false
    loadGoogleIdentityScript().then(() => {
      if (cancelled || !googleButton.current || !window.google) return
      googleButton.current.replaceChildren()
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response) => {
          setAuthError('')
          setAuthToken(response.credential)
          setAuthTokenState(response.credential)
        },
      })
      window.google.accounts.id.renderButton(googleButton.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'rectangular',
      })
    }).catch((error: Error) => setAuthError(error.message))
    return () => { cancelled = true }
  }, [authToken])

  useEffect(() => {
    const handleExpiredToken = () => {
      setAuthToken(null)
      setAuthTokenState(null)
      setUserEmail('')
      setAuthError('Your Google sign-in expired. Please sign in again.')
    }
    window.addEventListener('researchlens-auth-expired', handleExpiredToken)
    return () => window.removeEventListener('researchlens-auth-expired', handleExpiredToken)
  }, [])

  useEffect(() => {
    if (googleClientId && !authToken) return
    let cancelled = false
    setAuthToken(googleClientId ? authToken : null)
    const load = async () => {
      if (googleClientId) {
        try {
          const user = await api.me()
          if (!cancelled) setUserEmail(user.email)
        } catch (error) {
          if (cancelled) return
          setAuthToken(null)
          setAuthTokenState(null)
          setAuthError((error as Error).message)
          return
        }
      }
      try {
        await refresh()
      } catch (error) {
        if (!cancelled) setToast({ message: (error as Error).message, kind: 'error' })
      }
    }
    void load()
    return () => { cancelled = true }
  }, [refresh, authToken])

  useEffect(() => {
    setMenuOpen(false)
    if (toast) {
      const timer = window.setTimeout(() => setToast(null), 4500)
      return () => window.clearTimeout(timer)
    }
  }, [location, toast])

  const pageTitle = navigation.find((item) => item.to === location.pathname)?.label || (location.pathname.startsWith('/papers/') ? 'Paper detail' : 'Analysis results')
  const onUpload = async (files: File[]) => {
    const result = await api.upload(files)
    await refresh()
    setToast({ message: `${result.papers.length} paper${result.papers.length === 1 ? '' : 's'} added to your library.`, kind: 'success' })
  }
  const onDelete = async (id: string) => {
    await api.removePaper(id)
    await refresh()
    setToast({ message: 'Paper removed from your library.', kind: 'success' })
  }
  const onUploadDocuments = async (files: File[]) => {
    const response = await api.uploadDocuments(files)
    await refresh()
    setToast({ message: `${response.documents.length} supporting file${response.documents.length === 1 ? '' : 's'} added.`, kind: 'success' })
  }
  const onAnalyze = async (payload: Parameters<typeof api.analysis>[0]) => {
    const result = await api.analysis(payload)
    await refresh()
    return result
  }
  const onSignOut = () => {
    window.google?.accounts.id.disableAutoSelect()
    setAuthToken(null)
    setAuthTokenState(null)
    setUserEmail('')
  }
  const onDownloadReport = async (id: string) => {
    try {
      await api.downloadReport(id)
    } catch (error) {
      setToast({ message: (error as Error).message, kind: 'error' })
    }
  }

  if (googleClientId && (!authToken || !userEmail)) {
    return <main className="sign-in-page">
      <section className="sign-in-card">
        <div className="brand-mark"><ChartNoAxesCombined size={20} strokeWidth={2.2} /></div>
        <h1>ResearchLens</h1>
        <p>Sign in with an approved Google account to access your private research workspace.</p>
        <div ref={googleButton} className="google-sign-in" />
        {!authError && authToken && <p role="status">Verifying your Google account…</p>}
        {authError && <p className="sign-in-error" role="alert">{authError}</p>}
        {!authToken && !authError && <p className="sign-in-hint">Only approved Google accounts can sign in.</p>}
      </section>
    </main>
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><ChartNoAxesCombined size={20} strokeWidth={2.2} /></div>
          <span>Research<span className="brand-light">Lens</span></span>
          <button className="icon-button close-menu" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <div className="workspace-switch">
          <div className="workspace-icon">R</div>
          <div className="workspace-name"><b>My workspace</b><small>Personal library</small></div>
          <ChevronDown size={15} />
        </div>
        <p className="nav-caption">WORKSPACE</p>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map(({ label, to, icon: Icon }) => (
            <NavLink className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} key={to} to={to} end={to === '/'}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
              {label === 'Library' && papers.length > 0 && <span className="nav-count">{papers.length}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className={`ai-status ${aiEnabled ? 'ai-ready' : ''}`}>
            <div className="status-dot" />
            <div><b>{aiEnabled ? 'Gemini connected' : 'Local demo mode'}</b><small>{aiEnabled ? 'Live analysis enabled' : 'API key not configured'}</small></div>
            <ShieldCheck size={16} />
          </div>
          <NavLink to="/settings" className="nav-item bottom-nav"><Settings size={17} /><span>Settings</span></NavLink>
          <div className="profile">
            <div className="avatar">RL</div><div><b>Researcher</b><small>{userEmail || 'Local account'}</small></div>
            {googleClientId && <button className="sign-out-button" onClick={onSignOut}>Sign out</button>}
          </div>
        </div>
      </aside>
      {menuOpen && <button className="mobile-scrim" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="breadcrumbs">Workspace <span>/</span> <b>{pageTitle}</b></div>
          <div className="top-actions">
            <div className={`connection-pill ${aiEnabled ? 'connected' : ''}`}><span />{aiEnabled ? 'AI connected' : 'Local mode'}</div>
            <button className="help-button" title="Help and documentation"><CircleHelp size={18} /></button>
            <div className="avatar top-avatar">RL</div>
          </div>
        </header>
        <div className="page-container">
          <Routes>
            <Route path="/" element={<Dashboard papers={papers} analyses={analyses} aiEnabled={aiEnabled} />} />
            <Route path="/upload" element={<UploadPage papers={papers} onUpload={onUpload} />} />
            <Route path="/library" element={<LibraryPage papers={papers} onDelete={onDelete} />} />
            <Route path="/papers/:id" element={<PaperDetailPage />} />
            <Route path="/analysis" element={<CustomAnalysis papers={papers} documents={documents} onUploadDocuments={onUploadDocuments} onAnalyze={onAnalyze} onDownloadReport={onDownloadReport} />} />
            <Route path="/history" element={<HistoryPage analyses={analyses} />} />
            <Route path="/results/:id" element={<ResultPage analyses={analyses} onDownloadReport={onDownloadReport} />} />
            <Route path="/settings" element={<SettingsPage aiEnabled={aiEnabled} />} />
            <Route path="*" element={<Dashboard papers={papers} analyses={analyses} aiEnabled={aiEnabled} />} />
          </Routes>
        </div>
        <footer className="footer"><span>ResearchLens <span className="footer-dot">·</span> Evidence-grounded literature intelligence</span><span><span className="status-dot" />{googleClientId ? ' Your papers are private to your account' : ' Your papers stay on this device'}</span></footer>
      </main>
      {toast && <div className={`toast ${toast.kind}`} role="status"><span>{toast.kind === 'success' ? <Check size={17} /> : <X size={17} />}</span>{toast.message}<button onClick={() => setToast(null)} aria-label="Dismiss"><X size={15} /></button></div>}
    </div>
  )
}

const navigation = [
  { label: 'Overview', to: '/', icon: LayoutDashboard },
  { label: 'Upload papers', to: '/upload', icon: FilePlus2 },
  { label: 'Library', to: '/library', icon: FolderOpen },
  { label: 'Custom analysis', to: '/analysis', icon: FlaskConical },
  { label: 'Analysis history', to: '/history', icon: Clock3 },
]

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

function Dashboard({ papers, analyses, aiEnabled }: { papers: Paper[]; analyses: Analysis[]; aiEnabled: boolean }) {
  const words = papers.reduce((sum, paper) => sum + paper.word_count, 0)
  const gaps = analyses.reduce((sum, analysis) => sum + (analysis.result.research_gaps?.length || 0), 0)
  return (
    <>
      <PageHeading eyebrow="YOUR RESEARCH WORKSPACE" title="Good research starts with a clearer view." description="Bring your papers together, compare what they say, and explore the questions still waiting to be answered." action={<NavLink to="/analysis" className="button primary"><Sparkles size={16} /> Start an analysis</NavLink>} />
      {!aiEnabled && <div className="mode-banner"><div className="mode-icon"><FlaskConical size={17} /></div><div><b>You’re in local demo mode</b><span>PDF extraction and lexical overlap are available. Configure a Gemini API key for evidence-grounded AI summaries, embedding similarity, and gap discovery.</span></div><NavLink to="/settings">Set up AI <ArrowRight size={14} /></NavLink></div>}
      <section className="metric-grid">
        <Metric icon={<BookOpen size={17} />} label="Papers in library" value={papers.length.toString()} note={papers.length ? 'Ready to analyze' : 'Add your first paper'} color="blue" />
        <Metric icon={<Activity size={17} />} label="Analyses completed" value={analyses.length.toString()} note="Across your workspace" color="purple" />
        <Metric icon={<Search size={17} />} label="Potential gaps" value={gaps.toString()} note={aiEnabled ? 'Evidence-linked candidates' : 'Available with live AI'} color="amber" />
        <Metric icon={<FileText size={17} />} label="Words indexed" value={words >= 1000 ? `${(words / 1000).toFixed(1)}k` : words.toLocaleString()} note="Extracted from PDFs" color="green" />
      </section>
      <section className="dashboard-grid">
        <div className="panel focus-panel">
          <div className="panel-heading"><div><span className="eyebrow">GET STARTED</span><h2>Your research, in focus</h2></div><span className="tiny-icon"><Sparkles size={16} /></span></div>
          <p className="panel-description">A focused workflow to move from a stack of papers to a set of grounded, useful insights.</p>
          <div className="step-list">
            <Step number="01" icon={<Upload size={16} />} title="Add your research papers" detail="Upload text-based PDFs to build your library." to="/upload" done={papers.length > 0} />
            <Step number="02" icon={<FlaskConical size={16} />} title="Set your analysis focus" detail="Bring your own prompt, criteria, and questions." to="/analysis" done={analyses.length > 0} />
            <Step number="03" icon={<ChartNoAxesCombined size={16} />} title="Explore evidence-backed results" detail="Compare methods, evidence, and potential gaps." to="/history" done={analyses.length > 0} />
          </div>
          <NavLink to={papers.length ? '/analysis' : '/upload'} className="button secondary full-button">{papers.length ? 'Continue to custom analysis' : 'Upload your first paper'}<ArrowRight size={15} /></NavLink>
        </div>
        <div className="panel recent-panel">
          <div className="panel-heading"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Your latest analyses</h2></div><NavLink to="/history" className="text-link">View history <ArrowRight size={14} /></NavLink></div>
          {analyses.length === 0 ? <EmptyState icon={<Clock3 size={19} />} title="No analyses yet" detail="Your completed comparisons will show up here." link="/analysis" linkText="Create an analysis" /> : <div className="activity-list">{analyses.slice(0, 4).map((analysis) => <ActivityRow key={analysis.id} analysis={analysis} />)}</div>}
        </div>
      </section>
      <section className="insight-strip"><div className="insight-icon"><ShieldCheck size={18} /></div><div><b>Evidence over assumptions</b><span>Potential research gaps are linked to passages in your uploaded papers—not presented as proof of worldwide novelty.</span></div><NavLink to="/settings">Learn about the workflow <ArrowRight size={14} /></NavLink></section>
    </>
  )
}

function Metric({ icon, label, value, note, color }: { icon: ReactNode; label: string; value: string; note: string; color: string }) {
  return <div className="metric-card"><div className={`metric-icon ${color}`}>{icon}</div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></div>
}

function Step({ number, icon, title, detail, to, done }: { number: string; icon: ReactNode; title: string; detail: string; to: string; done: boolean }) {
  return <NavLink to={to} className="step-row"><div className={`step-icon ${done ? 'complete' : ''}`}>{done ? <Check size={15} /> : icon}</div><div className="step-copy"><b>{title}</b><span>{detail}</span></div><div className="step-number">{done ? 'DONE' : number}</div><ArrowRight size={15} className="step-arrow" /></NavLink>
}

function UploadPage({ papers, onUpload }: { papers: Paper[]; onUpload: (files: File[]) => Promise<void> }) {
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const chooseFiles = (selected: FileList | null) => {
    if (!selected) return
    const next = Array.from(selected)
    const invalid = next.find((file) => file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))
    if (invalid) { setError(`${invalid.name} is not a PDF file.`); return }
    setError('')
    setFiles((previous) => [...previous, ...next].slice(0, 10))
  }
  const submit = async () => {
    if (!files.length) return
    setBusy(true); setError('')
    try { await onUpload(files); setFiles([]) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <>
    <PageHeading eyebrow="PAPER LIBRARY" title="Build your research library" description="Upload papers to extract their text and prepare them for focused analysis." />
    <div className="upload-layout">
      <div>
        <div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFiles(event.dataTransfer.files) }}>
          <div className="drop-icon"><Upload size={22} /></div><h2>Drop your papers here</h2><p>or choose PDF files from your device</p>
          <label className="button primary file-picker"><FilePlus2 size={16} /> Browse files<input type="file" accept=".pdf,application/pdf" multiple onChange={(event) => chooseFiles(event.target.files)} /></label>
          <div className="upload-limits">PDF only <span>·</span> Up to 25 MB each <span>·</span> 10 files per upload</div>
        </div>
        {error && <div className="inline-error" role="alert"><X size={16} />{error}</div>}
        {files.length > 0 && <div className="panel selected-files"><div className="panel-heading"><div><span className="eyebrow">READY TO UPLOAD</span><h2>{files.length} selected</h2></div><button className="text-button" onClick={() => setFiles([])}>Clear all</button></div>{files.map((file, index) => <div className="file-row" key={`${file.name}-${index}`}><FileText size={17} /><div><b>{file.name}</b><span>{(file.size / 1024 / 1024).toFixed(1)} MB</span></div><button className="icon-button" onClick={() => setFiles((list) => list.filter((_, i) => i !== index))} aria-label={`Remove ${file.name}`}><X size={16} /></button></div>)}<button className="button primary full-button" onClick={submit} disabled={busy}>{busy ? <><span className="spinner" /> Extracting papers…</> : <><Upload size={16} /> Upload {files.length} {files.length === 1 ? 'paper' : 'papers'}</>}</button></div>}
      </div>
      <div className="panel upload-help"><div className="tiny-icon"><ShieldCheck size={17} /></div><span className="eyebrow">BEFORE YOU UPLOAD</span><h2>Keep your sources clear</h2><ul><li>Only PDF files with selectable text are processed.</li><li>Scanned image PDFs need OCR, which is not enabled in this version.</li><li>Extracted text and metadata are saved in your configured workspace; original PDF files are discarded after extraction.</li><li>Prompts and paper content are treated as untrusted input during AI analysis.</li></ul><div className="help-callout"><b>Want to start with an example?</b><span>Upload a paper you already know well and check that the extracted sections match your source.</span></div></div>
    </div>
    <div className="upload-library-link"><span><b>{papers.length}</b> {papers.length === 1 ? 'paper' : 'papers'} currently in your library</span><NavLink to="/library" className="text-link">View library <ArrowRight size={14} /></NavLink></div>
  </>
}

function LibraryPage({ papers, onDelete }: { papers: Paper[]; onDelete: (id: string) => Promise<void> }) {
  const [query, setQuery] = useState('')
  const filtered = papers.filter((paper) => `${paper.title} ${paper.filename}`.toLowerCase().includes(query.toLowerCase()))
  return <>
    <PageHeading eyebrow="YOUR SOURCES" title="Research paper library" description="A searchable home for the papers you have uploaded." action={<NavLink to="/upload" className="button primary"><FilePlus2 size={16} /> Add papers</NavLink>} />
    <div className="library-toolbar"><div className="search-box"><Search size={16} /><input placeholder="Search papers by title or filename" value={query} onChange={(event) => setQuery(event.target.value)} /></div><span className="library-total">{filtered.length} {filtered.length === 1 ? 'paper' : 'papers'}</span></div>
    {filtered.length === 0 ? <EmptyState icon={<FolderOpen size={20} />} title={papers.length ? 'No matching papers' : 'Your library is ready for its first paper'} detail={papers.length ? 'Try a different title or filename.' : 'Upload a text-based PDF to get started.'} link="/upload" linkText="Upload papers" /> : <div className="paper-grid">{filtered.map((paper) => <PaperCard key={paper.id} paper={paper} onDelete={onDelete} />)}</div>}
  </>
}

function PaperCard({ paper, onDelete }: { paper: Paper; onDelete: (id: string) => Promise<void> }) {
  const sections = Object.keys(paper.sections || {}).length
  const [busy, setBusy] = useState(false)
  return <article className="paper-card"><div className="paper-card-top"><div className="pdf-badge"><FileText size={19} /></div><button className="text-button danger-text" disabled={busy} onClick={async () => { if (window.confirm(`Remove “${paper.title}” from your library?`)) { setBusy(true); try { await onDelete(paper.id) } finally { setBusy(false) } } }}>Remove</button></div><h2>{paper.title}</h2><p className="paper-filename">{paper.filename}</p><div className="paper-card-meta"><span>{paper.page_count} pages</span><span>{paper.word_count.toLocaleString()} words</span></div><div className="paper-card-bottom"><span className="section-badge">{sections} sections detected</span><span>{new Date(paper.created_at).toLocaleDateString()}</span></div><NavLink to={`/papers/${paper.id}`} className="paper-view-link">View extracted paper <ArrowRight size={13} /></NavLink></article>
}

function PaperDetailPage() {
  const { id = '' } = useParams()
  const [paper, setPaper] = useState<import('./api').PaperDetail | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api.paper(id).then(setPaper).catch((reason: Error) => setError(reason.message))
  }, [id])
  if (error) return <EmptyState icon={<FileText size={20} />} title="Could not load this paper" detail={error} link="/library" linkText="Back to library" />
  if (!paper) return <div className="loading-state"><span className="spinner purple-spinner" /> Loading paper details…</div>
  const sections = Object.entries(paper.sections || {})
  return <>
    <PageHeading eyebrow="PAPER DETAIL" title={paper.title} description={`${paper.filename} · ${paper.page_count} pages · ${paper.word_count.toLocaleString()} words`} action={<NavLink to={`/analysis?paper=${paper.id}`} className="button primary"><Sparkles size={15} /> Analyze this paper</NavLink>} />
    <section className="panel paper-detail-panel"><div className="panel-heading"><div><span className="eyebrow">EXTRACTED SECTIONS</span><h2>{sections.length} sections detected</h2></div><span className="section-badge">Text extracted locally</span></div>{sections.length ? <div className="extracted-sections">{sections.map(([name, text]) => <details key={name} open={name === 'abstract'}><summary>{name.replace(/_/g, ' ')}</summary><p>{text}</p></details>)}</div> : <div className="no-gaps"><FileText size={16} />No standard section headings were confidently detected. You can still analyze the extracted text.</div>}<details className="full-text"><summary>View all extracted text</summary><pre>{paper.extracted_text}</pre></details></section>
  </>
}

function CustomAnalysis({ papers, documents, onUploadDocuments, onAnalyze, onDownloadReport }: { papers: Paper[]; documents: SupportingDocument[]; onUploadDocuments: (files: File[]) => Promise<void>; onAnalyze: (payload: Parameters<typeof api.analysis>[0]) => Promise<Analysis>; onDownloadReport: (id: string) => Promise<void> }) {
  const [searchParams] = useSearchParams()
  const [selected, setSelected] = useState<string[]>(() => {
    const paperId = searchParams.get('paper')
    return paperId ? [paperId] : []
  })
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([])
  const [prompt, setPrompt] = useState('')
  const [criteria, setCriteria] = useState('Methods used, datasets, evaluation metrics, limitations, contributions')
  const [questions, setQuestions] = useState('')
  const [mode, setMode] = useState('comprehensive')
  const [format, setFormat] = useState('detailed')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [review, setReview] = useState(false)
  const [documentBusy, setDocumentBusy] = useState(false)
  const [result, setResult] = useState<Analysis | null>(null)
  const togglePaper = (id: string) => setSelected((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])
  const toggleDocument = (id: string) => setSelectedDocuments((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])
  const uploadDocuments = async (files: FileList | null) => {
    if (!files?.length) return
    setDocumentBusy(true); setError('')
    try {
      await onUploadDocuments(Array.from(files))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDocumentBusy(false)
    }
  }
  const submit = async () => {
    setBusy(true); setError(''); setResult(null)
    try {
      const response = await onAnalyze({ prompt, paper_ids: selected, document_ids: selectedDocuments, mode, criteria: criteria.split(',').map((item) => item.trim()).filter(Boolean), questions: questions.split('\n').map((item) => item.trim()).filter(Boolean), report_format: format })
      setResult(response)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false); setReview(false) }
  }
  return <>
    <PageHeading eyebrow="CUSTOM ANALYSIS" title="Ask a better question" description="Set your own research lens and let the analysis follow your instructions." />
    <div className="analysis-layout">
      <div className="analysis-form">
        <section className="panel form-section"><div className="section-heading"><span className="section-number">01</span><div><h2>Choose your papers</h2><p>Select at least one paper from your library.</p></div><span className="selection-count">{selected.length} selected</span></div>
          {papers.length === 0 ? <div className="paper-empty"><BookOpen size={19} /><div><b>Your library is empty</b><span>Upload research papers before starting an analysis.</span></div><NavLink to="/upload" className="text-link">Upload papers <ArrowRight size={13} /></NavLink></div> : <div className="select-paper-list">{papers.map((paper) => <label className={`select-paper ${selected.includes(paper.id) ? 'selected' : ''}`} key={paper.id}><input type="checkbox" checked={selected.includes(paper.id)} onChange={() => togglePaper(paper.id)} /><span className="paper-checkbox">{selected.includes(paper.id) && <Check size={13} />}</span><FileText size={17} className="select-paper-icon" /><span className="select-paper-info"><b>{paper.title}</b><small>{paper.filename} · {paper.page_count} pages</small></span></label>)}</div>}
        </section>
        <section className="panel form-section"><div className="section-heading"><span className="section-number">02</span><div><h2>Write your analysis prompt</h2><p>Tell ResearchLens what to focus on. Your instructions are combined with evidence and safety rules.</p></div></div>
          <textarea className="prompt-area" value={prompt} maxLength={4000} onChange={(event) => setPrompt(event.target.value)} placeholder="Compare these papers on [your topic]. Focus on the algorithms used, datasets, evaluation metrics, limitations, and unresolved problems. Identify potential research gaps supported by evidence from the uploaded papers and suggest feasible research questions." />
          <div className="field-foot"><span>Be specific about scope, comparisons, and outputs.</span><span>{prompt.length}/4,000</span></div>
          <div className="quick-prompt"><span>Try an example:</span><button onClick={() => setPrompt('Compare the research approaches in these papers. Focus on their objectives, methodologies, datasets, results, limitations, and future work. Identify only potential gaps supported by direct evidence from the uploaded material and suggest three feasible research questions.')}>Evidence-based comparison <ArrowRight size={12} /></button></div>
        </section>
        <section className="panel form-section"><div className="section-heading"><span className="section-number">+</span><div><h2>Supporting documents</h2><p>Optionally include guidelines, notes, datasets, or references as additional context.</p></div></div>
          <label className="support-upload">{documentBusy ? <><span className="spinner purple-spinner" /> Adding document…</> : <><FilePlus2 size={15} /> Add PDF, TXT, Markdown, or CSV<input type="file" accept=".pdf,.txt,.md,.csv,application/pdf,text/plain,text/markdown,text/csv" multiple onChange={(event) => { void uploadDocuments(event.target.files); event.target.value = '' }} /></>}</label>
          {documents.length > 0 && <div className="support-list">{documents.map((document) => <label className={`support-row ${selectedDocuments.includes(document.id) ? 'selected' : ''}`} key={document.id}><input type="checkbox" checked={selectedDocuments.includes(document.id)} onChange={() => toggleDocument(document.id)} /><span className="paper-checkbox">{selectedDocuments.includes(document.id) && <Check size={13} />}</span><FileText size={15} /><span><b>{document.filename}</b><small>{document.word_count.toLocaleString()} words</small></span></label>)}</div>}
        </section>
        <section className="panel form-section"><div className="section-heading"><span className="section-number">03</span><div><h2>Shape your output</h2><p>Adjust the analysis mode and add domain-specific criteria.</p></div></div>
          <div className="two-fields"><label className="field-label">Analysis mode<select value={mode} onChange={(event) => setMode(event.target.value)}><option value="comprehensive">Comprehensive comparison</option><option value="similarity">Similarity and differences</option><option value="gaps">Research-gap discovery</option><option value="individual">Individual paper summaries</option></select></label><label className="field-label">Report format<select value={format} onChange={(event) => setFormat(event.target.value)}><option value="detailed">Detailed report</option><option value="concise">Concise summary</option><option value="table">Comparison-first</option></select></label></div>
          <label className="field-label criteria-field">Custom comparison criteria<input value={criteria} onChange={(event) => setCriteria(event.target.value)} placeholder="Separate criteria with commas" /></label>
          <label className="field-label">Domain-specific questions<textarea className="questions-area" value={questions} onChange={(event) => setQuestions(event.target.value)} placeholder={'One question per line (optional)\nWhich dataset is used most often?\nHow are the results evaluated?'} /></label>
        </section>
        <div className="analysis-submit-row"><div><ShieldCheck size={16} /><span>Paper content is treated as untrusted source material.</span></div><button className="button primary" disabled={busy || !selected.length || prompt.trim().length < 5} onClick={() => setReview(true)}><Sparkles size={16} /> Review analysis</button></div>
        {error && <div className="inline-error" role="alert"><X size={16} />{error}</div>}
        {result && <Results analysis={result} onDownloadReport={onDownloadReport} />}
      </div>
      <aside className="analysis-aside"><div className="panel workflow-panel"><span className="eyebrow">YOUR WORKFLOW</span><h2>From papers to perspective</h2><div className="workflow-step"><span>1</span><div><b>Read your sources</b><small>PDF text and likely section headings are extracted locally.</small></div></div><div className="workflow-step"><span>2</span><div><b>Follow your prompt</b><small>Your focus guides the analysis of the selected papers.</small></div></div><div className="workflow-step"><span>3</span><div><b>Check the evidence</b><small>Potential gaps are returned only with matching source excerpts.</small></div></div></div><div className="panel analysis-note"><div className="tiny-icon"><ShieldCheck size={16} /></div><b>Interpret with care</b><p>Candidate gaps reflect only the papers you selected. They do not establish that a topic is globally novel or unexplored.</p></div></aside>
    </div>
    {review && <div className="modal-scrim" role="presentation"><div className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title"><div className="modal-heading"><div><span className="eyebrow">FINAL CHECK</span><h2 id="review-title">Review your analysis</h2></div><button className="icon-button" onClick={() => setReview(false)} aria-label="Close"><X size={18} /></button></div><p className="review-label">PAPERS ({selected.length})</p><div className="review-papers">{papers.filter((paper) => selected.includes(paper.id)).map((paper) => <span key={paper.id}><FileText size={14} />{paper.title}</span>)}</div>{selectedDocuments.length > 0 && <><p className="review-label">SUPPORTING DOCUMENTS ({selectedDocuments.length})</p><div className="review-papers">{documents.filter((document) => selectedDocuments.includes(document.id)).map((document) => <span key={document.id}><FileText size={14} />{document.filename}</span>)}</div></>}<p className="review-label">YOUR PROMPT</p><div className="review-prompt">{prompt}</div><p className="review-label">MODE · {mode.replace('-', ' ')} · {format} report</p><div className="modal-actions"><button className="button secondary" onClick={() => setReview(false)}>Back to edit</button><button className="button primary" disabled={busy} onClick={submit}>{busy ? <><span className="spinner" /> Starting…</> : <><Sparkles size={15} /> Start analysis</>}</button></div></div></div>}
  </>
}

function Results({ analysis, onDownloadReport }: { analysis: Analysis; onDownloadReport: (id: string) => Promise<void> }) {
  const result = analysis.result
  return <section className="results-block" id="analysis-results"><div className="results-title"><div><span className="eyebrow">ANALYSIS COMPLETE · {analysis.provider === 'gemini' ? 'GEMINI AI' : 'LOCAL MODE'}</span><h2>Analysis results</h2></div><button className="button secondary small-button" onClick={() => void onDownloadReport(analysis.id)}><ArrowDownToLine size={15} /> Download report</button></div>
    {result.notice && <div className="result-notice"><ShieldCheck size={17} /><span>{result.notice}</span></div>}
    <div className="result-card"><h3>Executive summary</h3><p>{result.executive_summary}</p></div>
    {result.paper_summaries?.length > 0 && <div className="result-card"><h3>Individual paper summaries</h3>{result.paper_summaries.map((paper: any) => <div className="summary-row" key={paper.paper_id}><b>{paper.title}</b><p>{paper.summary}</p>{['objectives', 'methodology', 'datasets', 'results', 'limitations', 'future_work'].map((key) => paper[key] && paper[key] !== 'Not confidently extracted.' && <div className="summary-fact" key={key}><strong>{key.replace('_', ' ')}</strong><span>{paper[key]}</span></div>)}</div>)}</div>}
    {result.similarities?.length > 0 && <div className="result-card"><h3>Similarity analysis</h3><SimilarityMatrix similarities={result.similarities} papers={result.papers_analyzed || result.paper_summaries || []} /><p className="config-footnote">Similarity scores describe text-vector closeness only. They do not prove that papers make the same contribution or establish a research gap.</p>{result.similarities.map((entry: any, index: number) => <div className="similarity-row" key={index}><div><b>{entry.paper_titles?.join(' ↔ ') || entry.paper_ids?.join(' ↔ ')}</b><span>{entry.method} · {entry.explanation}</span></div><div className="similarity-score">{Math.round(entry.score * 100)}<small>%</small></div></div>)}</div>}
    {result.comparison?.length > 0 && <div className="result-card"><div className="panel-heading"><h3>Comparison matrix</h3>{result.comparison.some((item: any) => item?.criterion && Array.isArray(item.findings)) && <button className="button secondary small-button" onClick={() => downloadComparisonCsv(result.comparison, result.papers_analyzed || result.paper_summaries || [])}>Export CSV</button>}</div>{result.comparison.some((item: any) => item?.criterion && Array.isArray(item.findings)) ? <ComparisonMatrix comparison={result.comparison} papers={result.papers_analyzed || result.paper_summaries || []} /> : result.comparison.map((item: any, index: number) => <StructuredItem key={index} item={item} />)}</div>}
    <div className="result-card"><h3>Potential research gaps</h3>{result.research_gaps?.length ? result.research_gaps.map((gap: any, index: number) => <details className="gap-item" key={index}><summary><span><b>{gap.title}</b><small>{gap.confidence !== undefined ? `Confidence: ${Math.round(gap.confidence * 100)}%` : 'Candidate gap'}</small></span><ChevronDown size={17} /></summary><p>{gap.description}</p>{gap.uncertainty && <p className="uncertainty"><b>Uncertainty:</b> {gap.uncertainty}</p>}{gap.evidence?.map((evidence: any, evidenceIndex: number) => <blockquote key={evidenceIndex}><p>“{evidence.excerpt}”</p><cite>{evidence.paper_title}{evidence.page_number ? ` · p. ${evidence.page_number}` : ''}</cite></blockquote>)}{gap.counter_evidence?.length > 0 && <p><b>Counter-evidence:</b> {gap.counter_evidence.join(' ')}</p>}</details>) : <div className="no-gaps"><ShieldCheck size={18} /><span>{result.demo_mode ? 'Research-gap discovery requires live Gemini analysis. No gaps were generated in local mode.' : 'No evidence-supported gaps were identified in the selected papers.'}</span></div>}</div>
    {['repeated_limitations', 'research_questions', 'future_directions', 'limitations'].map((key) => result[key]?.length > 0 && <div className="result-card" key={key}><h3>{key.replace(/_/g, ' ').replace(/^\w/, (letter: string) => letter.toUpperCase())}</h3>{result[key].map((item: any, index: number) => <StructuredItem key={index} item={item} />)}</div>)}
  </section>
}

function StructuredItem({ item }: { item: any }) {
  return <div className="structured-item"><b>{typeof item === 'string' ? item : item.title || item.name || item.question || 'Finding'}</b>{item.description && <p>{item.description}</p>}{item.evidence?.map((evidence: any, index: number) => <blockquote key={index}><p>“{evidence.excerpt}”</p><cite>{evidence.paper_title}</cite></blockquote>)}</div>
}

function ComparisonMatrix({ comparison, papers }: { comparison: any[]; papers: any[] }) {
  return <div className="comparison-table-wrap"><table className="comparison-table"><thead><tr><th>Criterion</th>{papers.map((paper) => <th key={paper.paper_id}>{paper.title}</th>)}</tr></thead><tbody>{comparison.filter((item) => item?.criterion && Array.isArray(item.findings)).map((item, index) => <tr key={`${item.criterion}-${index}`}><th>{item.criterion}</th>{papers.map((paper) => <td key={paper.paper_id}>{item.findings.find((finding: any) => finding.paper_id === paper.paper_id)?.finding || 'Not reported in supplied text'}</td>)}</tr>)}</tbody></table></div>
}

function SimilarityMatrix({ similarities, papers }: { similarities: any[]; papers: any[] }) {
  const scores = new Map<string, number>()
  similarities.forEach((entry) => {
    if (Array.isArray(entry.paper_ids) && entry.paper_ids.length === 2 && typeof entry.score === 'number') {
      scores.set(`${entry.paper_ids[0]}:${entry.paper_ids[1]}`, entry.score)
      scores.set(`${entry.paper_ids[1]}:${entry.paper_ids[0]}`, entry.score)
    }
  })
  return <div className="comparison-table-wrap"><table className="comparison-table similarity-matrix"><thead><tr><th>Paper</th>{papers.map((paper) => <th key={paper.paper_id}>{paper.title}</th>)}</tr></thead><tbody>{papers.map((paper) => <tr key={paper.paper_id}><th>{paper.title}</th>{papers.map((other) => {
    const score = paper.paper_id === other.paper_id ? 1 : scores.get(`${paper.paper_id}:${other.paper_id}`)
    const opacity = score === undefined ? 0 : Math.max(0.08, Math.min(0.45, ((score + 1) / 2) * 0.45))
    return <td key={other.paper_id} style={{ backgroundColor: score === undefined ? undefined : `rgba(101, 88, 223, ${opacity})` }}>{score === undefined ? '—' : `${Math.round(score * 100)}%`}</td>
  })}</tr>)}</tbody></table></div>
}

function downloadComparisonCsv(comparison: any[], papers: any[]) {
  const cells = (value: unknown) => {
    const text = String(value ?? '')
    const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text
    return `"${safeText.replace(/"/g, '""')}"`
  }
  const rows = [
    ['Criterion', ...papers.map((paper) => paper.title)],
    ...comparison
      .filter((item) => item?.criterion && Array.isArray(item.findings))
      .map((item) => [
        item.criterion,
        ...papers.map((paper) => item.findings.find((finding: any) => finding.paper_id === paper.paper_id)?.finding || 'Not reported in supplied text'),
      ]),
  ]
  const blob = new Blob([`\uFEFF${rows.map((row) => row.map(cells).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'researchlens-comparison.csv'
  link.click()
  URL.revokeObjectURL(url)
}

function HistoryPage({ analyses }: { analyses: Analysis[] }) {
  const data = analyses.slice(0, 8).map((analysis, index) => ({ name: new Date(analysis.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), analyses: analyses.length - index }))
  return <>
    <PageHeading eyebrow="WORKSPACE ACTIVITY" title="Analysis history" description="Return to a previous research question and its saved results." action={<NavLink to="/analysis" className="button primary"><Sparkles size={16} /> New analysis</NavLink>} />
    {analyses.length === 0 ? <EmptyState icon={<Clock3 size={20} />} title="Your analysis history is empty" detail="Run your first custom analysis to save it here." link="/analysis" linkText="Start an analysis" /> : <>
      {analyses.length > 1 && <div className="panel chart-panel"><div className="panel-heading"><div><span className="eyebrow">ACTIVITY</span><h2>Recent analysis sessions</h2></div><span className="chart-caption">Most recent {data.length}</span></div><div className="chart-wrap"><ResponsiveMiniChart data={data} /></div></div>}
      <div className="panel history-panel"><div className="panel-heading"><div><span className="eyebrow">SAVED SESSIONS</span><h2>All analyses</h2></div><span className="library-total">{analyses.length} total</span></div><div className="activity-list history-list">{analyses.map((analysis) => <ActivityRow key={analysis.id} analysis={analysis} />)}</div></div>
    </>}
  </>
}

function ResponsiveMiniChart({ data }: { data: { name: string; analyses: number }[] }) {
  return <div className="chart-surface"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data}><defs><linearGradient id="analysisFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6558df" stopOpacity={0.2} /><stop offset="100%" stopColor="#6558df" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid stroke="#edf0f4" vertical={false} /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#8a92a2', fontSize: 11 }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#8a92a2', fontSize: 11 }} width={26} /><Tooltip /><Area type="monotone" dataKey="analyses" stroke="#6558df" strokeWidth={2.5} fill="url(#analysisFill)" /></AreaChart></ResponsiveContainer></div>
}

function ActivityRow({ analysis }: { analysis: Analysis }) {
  const count = analysis.result.paper_summaries?.length || 0
  const gaps = analysis.result.research_gaps?.length || 0
  return <NavLink to={`/results/${analysis.id}`} className="activity-row"><div className="activity-icon"><FlaskConical size={16} /></div><div className="activity-copy"><b>{analysis.prompt}</b><span>{new Date(analysis.created_at).toLocaleString()} · {count} papers · {analysis.provider === 'gemini' ? 'Gemini' : 'Local mode'}</span></div><div className="activity-gaps">{gaps} {gaps === 1 ? 'gap' : 'gaps'}</div><ArrowRight size={15} className="activity-arrow" /></NavLink>
}

function ResultPage({ analyses, onDownloadReport }: { analyses: Analysis[]; onDownloadReport: (id: string) => Promise<void> }) {
  const { id } = useParams()
  const analysis = analyses.find((entry) => entry.id === id)
  if (!analysis) return <EmptyState icon={<FileText size={20} />} title="Analysis not found" detail="It may have been removed or is still loading." link="/history" linkText="Back to history" />
  return <><PageHeading eyebrow="SAVED RESULTS" title="Research analysis" description={new Date(analysis.created_at).toLocaleString()} action={<button className="button secondary" onClick={() => void onDownloadReport(analysis.id)}><ArrowDownToLine size={15} /> Download PDF</button>} /><Results analysis={analysis} onDownloadReport={onDownloadReport} /></>
}

function SettingsPage({ aiEnabled }: { aiEnabled: boolean }) {
  return <>
    <PageHeading eyebrow="PREFERENCES & CONFIGURATION" title="Settings & API setup" description="Configure the analysis provider without ever exposing your API key to the browser." />
    <div className="settings-layout"><section className="panel settings-card"><div className="settings-status"><div className={`metric-icon ${aiEnabled ? 'green' : 'amber'}`}><Gauge size={18} /></div><div><span className="eyebrow">AI PROVIDER STATUS</span><h2>{aiEnabled ? 'Gemini is configured' : 'Local demo mode is active'}</h2><p>{aiEnabled ? 'Live analysis and embedding similarity are available.' : 'Uploads, text extraction, local lexical overlap, and PDF reports work without an API key.'}</p></div></div><div className="settings-divider" /><h3>Enable live AI analysis</h3><ol className="setup-list"><li><span>1</span><div><b>Create a Gemini API key</b><p>Use Google AI Studio to create a key for Gemini API access. Review provider terms and usage limits.</p></div></li><li><span>2</span><div><b>Add the key to your local environment</b><p>Copy the project’s <code>.env.example</code> to <code>.env</code> in the project root and set <code>GEMINI_API_KEY=your_key</code>.</p></div></li><li><span>3</span><div><b>Restart the backend</b><p>The key is read by FastAPI on startup and is never sent to React or included in API responses.</p></div></li></ol><div className="security-callout"><ShieldCheck size={17} /><div><b>Keep your key private</b><span>Never add .env to source control, paste keys into the analysis prompt, or share them in screenshots.</span></div></div></section><section className="panel config-card"><div className="tiny-icon"><Settings size={16} /></div><span className="eyebrow">SERVER CONFIGURATION</span><h2>Environment variables</h2><div className="config-row"><code>GEMINI_API_KEY</code><span>Private API key</span></div><div className="config-row"><code>GEMINI_MODEL</code><span>gemini-3.8-flash</span></div><div className="config-row"><code>GEMINI_EMBEDDING_MODEL</code><span>gemini-embedding-001</span></div><div className="config-row"><code>MAX_UPLOAD_MB</code><span>25 MB per paper</span></div><p className="config-footnote">All values are read by the Python backend. Browser configuration contains only the API base URL.</p></section></div>
  </>
}

function EmptyState({ icon, title, detail, link, linkText }: { icon: ReactNode; title: string; detail: string; link: string; linkText: string }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{detail}</p><NavLink to={link} className="button secondary">{linkText}<ArrowRight size={14} /></NavLink></div>
}

export default App
