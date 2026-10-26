import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Activity, ArrowDownToLine, ArrowRight, BarChart3, BookOpen, ChartNoAxesCombined, Check,
  ChevronDown, CircleHelp, Clock3, FilePlus2, FileText, FlaskConical, FolderOpen,
  LayoutDashboard, Lightbulb, Menu, MessageCircle, Search, Settings, ShieldCheck, Sparkles, Trash2, Upload, X,
} from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, setAuthToken, type Analysis, type AssistantConversation, type Paper, type Project, type SupportingDocument } from './api'
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
  const [projects, setProjects] = useState<Project[]>([])
  const [aiEnabled, setAiEnabled] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [authToken, setAuthTokenState] = useState<string | null>(() => sessionStorage.getItem('researchlens.googleToken'))
  const [userEmail, setUserEmail] = useState('')
  const [authError, setAuthError] = useState('')
  const googleButton = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const navigate = useNavigate()

  const refresh = useCallback(async () => {
    const [paperList, documentList, analysisList, projectList, health] = await Promise.all([
      api.papers(), api.documents(), api.analyses(), api.projects(), api.health(),
    ])
    setPapers(paperList)
    setDocuments(documentList)
    setAnalyses(analysisList)
    setProjects(projectList)
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

  const pageTitle = location.pathname === '/analysis'
    ? location.search.includes('tab=compare') ? 'Compare papers' : 'Custom analysis'
    : navigation.find((item) => item.to.split('?')[0] === location.pathname)?.label
      || (location.pathname.startsWith('/papers/') ? 'Paper detail' : location.pathname.startsWith('/results/') ? 'Analysis results' : 'ResearchLens')
  const pageTheme = location.pathname === '/analysis'
    ? location.search.includes('tab=compare') ? 'compare' : 'analysis'
    : location.pathname === '/papers/:id' || location.pathname.startsWith('/papers/') ? 'paper'
      : location.pathname.startsWith('/results/') ? 'results'
        : location.pathname === '/' ? 'dashboard'
          : location.pathname.slice(1) || 'dashboard'
  const onUpload = async (files: File[]) => {
    const result = await api.upload(files)
    await refresh()
    setToast({ message: `${result.papers.length} paper${result.papers.length === 1 ? '' : 's'} added to your library.`, kind: 'success' })
    navigate('/analysis?tab=compare')
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
          <div className="workspace-name"><b>My workspace</b><small>{projects.length} research projects</small></div>
          <ChevronDown size={15} />
        </div>
        <p className="nav-caption">WORKSPACE</p>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map(({ label, to, icon: Icon }) => (
            <NavLink className={({ isActive }) => {
              const selectedTab = to.includes('tab=compare') ? location.search.includes('tab=compare') : to.includes('tab=custom') ? !location.search.includes('tab=compare') : false
              return `nav-item ${location.pathname === '/analysis' && to.startsWith('/analysis?') ? selectedTab ? 'active' : '' : isActive ? 'active' : ''}`
            }} key={to} to={to} end={to === '/'}>
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
      <main className={`main-area page-theme-${pageTheme}`}>
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
            <Route path="/analytics" element={<AnalyticsPage papers={papers} analyses={analyses} />} />
            <Route path="/upload" element={<UploadPage papers={papers} onUpload={onUpload} />} />
            <Route path="/library" element={<LibraryPage papers={papers} onDelete={onDelete} />} />
            <Route path="/papers/:id" element={<PaperDetailPage />} />
            <Route path="/analysis" element={<CustomAnalysis papers={papers} projects={projects} documents={documents} onUploadDocuments={onUploadDocuments} onAnalyze={onAnalyze} onDownloadReport={onDownloadReport} />} />
            <Route path="/compare" element={<Navigate to="/analysis?tab=compare" replace />} />
            <Route path="/gaps" element={<ResearchGapsPage analyses={analyses} />} />
            <Route path="/assistant" element={<AssistantPage papers={papers} aiEnabled={aiEnabled} />} />
            <Route path="/projects" element={<ProjectsPage papers={papers} projects={projects} analyses={analyses} onRefresh={refresh} />} />
            <Route path="/reports" element={<ReportsPage analyses={analyses} onDownloadReport={onDownloadReport} />} />
            <Route path="/history" element={<HistoryPage analyses={analyses} />} />
            <Route path="/results/:id" element={<ResultPage analyses={analyses} onDownloadReport={onDownloadReport} />} />
            <Route path="/settings" element={<SettingsPage aiEnabled={aiEnabled} userEmail={userEmail} authenticated={Boolean(googleClientId)} />} />
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
  { label: 'Analytics', to: '/analytics', icon: BarChart3 },
  { label: 'Upload papers', to: '/upload', icon: FilePlus2 },
  { label: 'Library', to: '/library', icon: FolderOpen },
  { label: 'Projects', to: '/projects', icon: BookOpen },
  { label: 'Compare papers', to: '/analysis?tab=compare', icon: FlaskConical },
  { label: 'Research gaps', to: '/gaps', icon: Lightbulb },
  { label: 'Custom analysis', to: '/analysis?tab=custom', icon: FlaskConical },
  { label: 'Research assistant', to: '/assistant', icon: MessageCircle },
  { label: 'Reports', to: '/reports', icon: FileText },
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

function AnalyticsPage({ papers, analyses }: { papers: Paper[]; analyses: Analysis[] }) {
  const gapsByPaper = new Map<string, number>()
  const methodCounts = new Map<string, number>()
  const similarityRows: { pair: string; score: number }[] = []
  analyses.forEach((analysis) => {
    const names = new Map((analysis.result.papers_analyzed || []).map((paper: any) => [paper.paper_id, paper.title]))
    ;(analysis.result.research_gaps || []).forEach((gap: any) => {
      ;(gap.evidence || []).forEach((evidence: any) => {
        const title = evidence.paper_title || names.get(evidence.paper_id) || 'Source paper'
        gapsByPaper.set(title, (gapsByPaper.get(title) || 0) + 1)
      })
    })
    ;(analysis.result.paper_summaries || []).forEach((summary: any) => {
      const methodology = String(summary.methodology || '').trim()
      if (methodology && !/not confidently extracted/i.test(methodology)) {
        const label = methodology.length > 50 ? `${methodology.slice(0, 47)}…` : methodology
        methodCounts.set(label, (methodCounts.get(label) || 0) + 1)
      }
    })
    ;(analysis.result.similarities || []).forEach((entry: any) => {
      if (typeof entry.score === 'number') {
        similarityRows.push({
          pair: (entry.paper_titles || entry.paper_ids || []).join(' ↔ '),
          score: Math.round(entry.score * 100),
        })
      }
    })
  })
  const evidenceData = [...gapsByPaper.entries()].map(([name, citations]) => ({ name, citations })).sort((a, b) => b.citations - a.citations).slice(0, 8)
  const methodData = [...methodCounts.entries()].map(([name, papersCount]) => ({ name, papers: papersCount })).sort((a, b) => b.papers - a.papers).slice(0, 8)
  const activity = analyses.slice(0, 12).reverse().map((analysis) => ({
    date: new Date(analysis.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    gaps: analysis.result.research_gaps?.length || 0,
    papers: analysis.result.papers_analyzed?.length || analysis.result.paper_summaries?.length || 0,
  }))
  return <>
    <PageHeading eyebrow="RESEARCH LANDSCAPE" title="Analytics" description="Explore counts and comparisons derived from your saved papers and analyses. Charts stay empty when there is no evidence to plot." action={<NavLink to="/analysis" className="button primary"><Sparkles size={15} /> Run analysis</NavLink>} />
    <section className="metric-grid">
      <Metric icon={<BookOpen size={17} />} label="Papers in library" value={papers.length.toString()} note="Available to analyze" color="blue" />
      <Metric icon={<Activity size={17} />} label="Saved analyses" value={analyses.length.toString()} note="Available in history" color="purple" />
      <Metric icon={<ShieldCheck size={17} />} label="Evidence-linked gaps" value={analyses.reduce((total, analysis) => total + (analysis.result.research_gaps || []).length, 0).toString()} note="From saved AI analyses" color="amber" />
      <Metric icon={<ChartNoAxesCombined size={17} />} label="Similarity pairs" value={similarityRows.length.toString()} note="Observed comparisons" color="green" />
    </section>
    {analyses.length === 0 ? <EmptyState icon={<BarChart3 size={20} />} title="Your analytics will appear here" detail="Run an analysis on your uploaded papers to generate real comparison and evidence data." link="/analysis" linkText="Start an analysis" /> : <div className="analytics-grid">
      <section className="panel analytics-panel"><div className="panel-heading"><div><span className="eyebrow">SAVED ANALYSES</span><h2>Paper and gap counts</h2></div><span className="chart-caption">Observed values</span></div><div className="analytics-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={activity}><defs><linearGradient id="analyticsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6558df" stopOpacity={0.2} /><stop offset="100%" stopColor="#6558df" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid stroke="#edf0f4" vertical={false} /><XAxis dataKey="date" axisLine={false} tickLine={false} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} /><Tooltip /><Area type="monotone" dataKey="papers" name="Papers analyzed" stroke="#6558df" fill="url(#analyticsFill)" /><Area type="monotone" dataKey="gaps" name="Candidate gaps" stroke="#e2a640" fill="transparent" /></AreaChart></ResponsiveContainer></div></section>
      <AnalyticsChart title="Evidence mentions by paper" subtitle="Citations attached to candidate gaps" rows={evidenceData} dataKey="citations" empty="No gap evidence was recorded in saved analyses." />
      <AnalyticsChart title="Extracted methodology signals" subtitle="Methodology text present in saved paper summaries" rows={methodData} dataKey="papers" empty="No methodology summaries are available yet." />
      <AnalyticsChart title="Paper similarity pairs" subtitle="Scores from saved comparisons; not a novelty measure" rows={similarityRows.slice(0, 8)} dataKey="score" empty="Run a multi-paper analysis with AI enabled to record similarity pairs." />
    </div>}
    <p className="config-footnote analytics-disclaimer">Counts describe saved analysis outputs only. They are not an exhaustive or globally representative map of the literature.</p>
  </>
}

function AnalyticsChart({ title, subtitle, rows, dataKey, empty }: { title: string; subtitle: string; rows: Record<string, any>[]; dataKey: string; empty: string }) {
  return <section className="panel analytics-panel"><div className="panel-heading"><div><span className="eyebrow">FROM YOUR DATA</span><h2>{title}</h2><p>{subtitle}</p></div></div>{rows.length ? <div className="analytics-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows} layout="vertical" margin={{ left: 15, right: 20 }}><CartesianGrid stroke="#edf0f4" horizontal={false} /><XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="name" width={130} axisLine={false} tickLine={false} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey={dataKey} name={dataKey === 'score' ? 'Similarity (%)' : dataKey === 'citations' ? 'Evidence mentions' : 'Papers'} fill="#6558df" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div> : <div className="chart-empty">{empty}</div>}</section>
}

function ProjectsPage({ papers, projects, analyses, onRefresh }: { papers: Paper[]; projects: Project[]; analyses: Analysis[]; onRefresh: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await api.createProject({ name, description })
      setName(''); setDescription('')
      await onRefresh()
    } catch (reason) {
      setError((reason as Error).message)
    } finally { setBusy(false) }
  }
  return <>
    <PageHeading eyebrow="ORGANIZE YOUR WORK" title="Research projects" description="Group papers by research question. Project membership is saved with your account and does not duplicate uploaded files." />
    <form className="panel project-create" onSubmit={(event) => void create(event)}>
      <div><span className="eyebrow">NEW PROJECT</span><h2>Create a research project</h2></div>
      <div className="project-create-fields"><label className="field-label">Project name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Multilingual evaluation" /></label><label className="field-label">Description<input maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Research question or scope (optional)" /></label><button className="button primary" disabled={busy || !name.trim()}><FolderOpen size={15} /> Create project</button></div>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </form>
    {!projects.length ? <EmptyState icon={<FolderOpen size={20} />} title="No projects yet" detail={papers.length ? 'Create a project, then select papers from your library to organize them.' : 'Upload papers and create a project to begin organizing your research.'} link={papers.length ? '/library' : '/upload'} linkText={papers.length ? 'View paper library' : 'Upload papers'} /> : <div className="project-grid">{projects.map((project) => <ProjectCard key={project.id} project={project} papers={papers} analyses={analyses.filter((analysis) => project.analysis_ids.includes(analysis.id))} onRefresh={onRefresh} />)}</div>}
  </>
}

function ProjectCard({ project, papers, analyses, onRefresh }: { project: Project; papers: Paper[]; analyses: Analysis[]; onRefresh: () => Promise<void> }) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description)
  const [selected, setSelected] = useState<string[]>(project.paper_ids)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setName(project.name); setDescription(project.description); setSelected(project.paper_ids) }, [project])
  const save = async () => {
    setBusy(true); setError('')
    try {
      await api.updateProject(project.id, { name, description })
      await api.assignProjectPapers(project.id, selected)
      await onRefresh()
    } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!window.confirm(`Delete project “${project.name}”? Papers will remain in your library, unassigned.`)) return
    setBusy(true); setError('')
    try { await api.deleteProject(project.id); await onRefresh() } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }
  return <section className="panel project-card"><div className="panel-heading"><div className="project-card-icon"><FolderOpen size={17} /></div><span className="library-total">{selected.length} papers · {analyses.length} analyses</span></div><label className="field-label">Project name<input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field-label project-description">Description<input maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} /></label><div className="project-paper-select"><b>Paper membership</b>{papers.length ? papers.map((paper) => <label key={paper.id}><input type="checkbox" checked={selected.includes(paper.id)} onChange={() => setSelected((ids) => ids.includes(paper.id) ? ids.filter((id) => id !== paper.id) : [...ids, paper.id])} /><span>{paper.title}</span></label>) : <small>Upload papers to add them to this project.</small>}</div>{analyses.length > 0 && <div className="project-analyses"><b>Saved analyses</b>{analyses.map((analysis) => <NavLink key={analysis.id} to={`/results/${analysis.id}`}>{analysis.prompt}<ArrowRight size={12} /></NavLink>)}</div>}<div className="project-actions"><button className="button secondary small-button" disabled={busy} onClick={() => void save()}>Save project</button><button className="text-button danger-text" disabled={busy} onClick={() => void remove()}>Delete</button></div>{error && <p className="inline-error" role="alert">{error}</p>}</section>
}

function AssistantPage({ papers, aiEnabled }: { papers: Paper[]; aiEnabled: boolean }) {
  const [threads, setThreads] = useState<AssistantConversation[]>([])
  const [conversation, setConversation] = useState<AssistantConversation | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadThreads = useCallback(async () => setThreads(await api.assistantConversations()), [])
  useEffect(() => { void loadThreads().catch((reason: Error) => setError(reason.message)) }, [loadThreads])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [conversation?.messages.length, busy])
  const startNew = () => { setConversation(null); setSelected([]); setQuestion(''); setError('') }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!question.trim() || !selected.length) return
    setBusy(true); setError('')
    try {
      const updated = await api.assistantChat({ question: question.trim(), paper_ids: selected, conversation_id: conversation?.id })
      setConversation(updated); setQuestion('')
      await loadThreads()
    } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }
  const openThread = (thread: AssistantConversation) => {
    setConversation(thread); setSelected(thread.paper_ids); setError('')
  }
  const deleteThread = async (thread: AssistantConversation) => {
    if (!window.confirm(`Delete this conversation, “${thread.title}”?`)) return
    setError('')
    try {
      await api.deleteAssistantConversation(thread.id)
      if (conversation?.id === thread.id) startNew()
      await loadThreads()
    } catch (reason) { setError((reason as Error).message) }
  }
  return <>
    <PageHeading eyebrow="PAPER-GROUNDED CHAT" title="Research assistant" description="Ask questions about selected papers. Answers are generated from retrieved excerpts and show the passages used." action={<button className="button secondary" onClick={startNew}><MessageCircle size={15} /> New chat</button>} />
    {!aiEnabled && <div className="mode-banner"><div className="mode-icon"><ShieldCheck size={17} /></div><div><b>AI assistant unavailable in local mode</b><span>Configure GEMINI_API_KEY on the backend to ask questions. The assistant will not produce demo answers.</span></div><NavLink to="/settings">Settings <ArrowRight size={14} /></NavLink></div>}
    <div className="assistant-layout">
      <aside className="panel assistant-history"><div className="panel-heading"><h2>Conversations</h2><button className="icon-button" aria-label="Start new conversation" onClick={startNew}><Sparkles size={15} /></button></div>{threads.length ? threads.map((thread) => <div className="assistant-thread-row" key={thread.id}><button className={`assistant-thread ${conversation?.id === thread.id ? 'selected' : ''}`} onClick={() => openThread(thread)}><b>{thread.title}</b><small>{new Date(thread.updated_at).toLocaleString()}</small></button><button className="icon-button assistant-thread-delete" aria-label={`Delete conversation ${thread.title}`} onClick={() => void deleteThread(thread)}><Trash2 size={13} /></button></div>) : <p className="chart-empty">Your saved chats will appear here.</p>}</aside>
      <section className="panel assistant-chat">
        <div className="assistant-paper-picker"><b>Use these papers</b>{papers.length ? papers.map((paper) => <label key={paper.id}><input type="checkbox" disabled={Boolean(conversation)} checked={selected.includes(paper.id)} onChange={() => setSelected((ids) => ids.includes(paper.id) ? ids.filter((id) => id !== paper.id) : [...ids, paper.id])} /><span>{paper.title}</span></label>) : <span className="config-footnote">Upload papers before chatting.</span>}</div>
        <div className="assistant-messages" ref={scrollRef}>{conversation?.messages.map((message, index) => <article className={`chat-message ${message.role}`} key={`${conversation.id}-${index}`}><span className="chat-role">{message.role === 'user' ? 'You' : 'ResearchLens'}</span><p>{message.content}</p>{message.sources?.length ? <details className="chat-sources"><summary>Sources used ({message.sources.length})</summary>{message.sources.map((source, sourceIndex) => <blockquote key={`${source.paper_id}-${sourceIndex}`}><p>{source.excerpt}</p><cite>[S{sourceIndex + 1}] {source.paper_title}{source.page_number ? ` · p. ${source.page_number}` : ''}</cite></blockquote>)}</details> : null}</article>) || <div className="assistant-welcome"><div className="tiny-icon"><MessageCircle size={17} /></div><h2>Ask about your papers</h2><p>Select one or more papers, then ask about their methods, results, concepts, or differences.</p></div>}{busy && <div className="chat-loading"><span className="spinner purple-spinner" /> Retrieving evidence and preparing an answer…</div>}</div>
        <form className="assistant-compose" onSubmit={(event) => void submit(event)}><label htmlFor="assistant-question" className="sr-only">Your question</label><textarea id="assistant-question" value={question} maxLength={2000} onChange={(event) => setQuestion(event.target.value)} placeholder={selected.length ? 'Ask a question about the selected papers…' : 'Choose at least one paper to begin…'} disabled={!aiEnabled || busy || !selected.length} /><button className="button primary" disabled={!aiEnabled || busy || !selected.length || question.trim().length < 2}><ArrowRight size={16} /> Send</button></form>
        {error && <p className="inline-error" role="alert">{error}</p>}
      </section>
    </div>
  </>
}

function ReportsPage({ analyses, onDownloadReport }: { analyses: Analysis[]; onDownloadReport: (id: string) => Promise<void> }) {
  return <>
    <PageHeading eyebrow="EXPORT & SHARE" title="Reports" description="Download saved analyses as PDF or export a portable HTML summary and comparison table." />
    {!analyses.length ? <EmptyState icon={<FileText size={20} />} title="No reports to export" detail="Run and save an analysis first. It will be available here for export." link="/analysis" linkText="Create an analysis" /> : <div className="reports-list">{analyses.map((analysis) => <article className="panel report-row" key={analysis.id}><div className="report-icon"><FileText size={18} /></div><div className="report-copy"><b>{analysis.prompt}</b><span>{new Date(analysis.created_at).toLocaleString()} · {analysis.result.papers_analyzed?.length || 0} papers · {analysis.result.research_gaps?.length || 0} candidate gaps</span></div><div className="report-actions"><button className="button secondary small-button" onClick={() => void onDownloadReport(analysis.id)}><ArrowDownToLine size={14} /> PDF</button><button className="button secondary small-button" onClick={() => downloadAnalysisHtml(analysis)}><ArrowDownToLine size={14} /> HTML</button>{analysis.result.comparison?.some((row: any) => row?.criterion && Array.isArray(row.findings)) && <button className="button secondary small-button" onClick={() => downloadComparisonCsv(analysis.result.comparison, analysis.result.papers_analyzed || [])}>CSV</button>}<NavLink className="button secondary small-button" to={`/results/${analysis.id}`}>View</NavLink></div></article>)}</div>}
  </>
}

function downloadAnalysisHtml(analysis: Analysis) {
  const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character)
  const paragraphs = [
    `<h2>Executive summary</h2><p>${escape(analysis.result.executive_summary || 'Not available')}</p>`,
    `<h2>Paper comparison</h2>${(analysis.result.comparison || []).map((row: any) => `<section><h3>${escape(row.criterion || 'Finding')}</h3><ul>${(row.findings || []).map((finding: any) => `<li><b>${escape(finding.paper_title)}</b>: ${escape(finding.finding)}</li>`).join('')}</ul></section>`).join('')}`,
    `<h2>Potential research gaps</h2>${(analysis.result.research_gaps || []).map((gap: any) => `<section><h3>${escape(gap.title)}</h3><p>${escape(gap.description)}</p>${(gap.evidence || []).map((source: any) => `<blockquote>${escape(source.excerpt)}<br><small>${escape(source.paper_title)}${source.page_number ? ` · p. ${escape(source.page_number)}` : ''}</small></blockquote>`).join('')}</section>`).join('')}`,
  ].join('\n')
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(analysis.prompt)} · ResearchLens</title><style>body{max-width:900px;margin:40px auto;padding:0 20px;font:16px/1.6 system-ui;color:#202534}h1,h2{color:#5549c7}section,blockquote{padding:12px;border-left:3px solid #dedaf8;background:#faf9ff}small{color:#6c7080}</style><h1>ResearchLens analysis report</h1><p>${escape(analysis.prompt)}</p><p>Generated ${escape(new Date(analysis.created_at).toLocaleString())}</p>${paragraphs}</html>`
  downloadBlob(html, `researchlens-${analysis.id.slice(0, 8)}.html`, 'text/html;charset=utf-8')
}

function downloadBlob(content: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
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

function CustomAnalysis({ papers, projects, documents, onUploadDocuments, onAnalyze, onDownloadReport }: { papers: Paper[]; projects: Project[]; documents: SupportingDocument[]; onUploadDocuments: (files: File[]) => Promise<void>; onAnalyze: (payload: Parameters<typeof api.analysis>[0]) => Promise<Analysis>; onDownloadReport: (id: string) => Promise<void> }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const compareMode = searchParams.get('tab') === 'compare'
  const [selected, setSelected] = useState<string[]>(() => {
    const paperId = searchParams.get('paper')
    return paperId ? [paperId] : []
  })
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([])
  const [projectId, setProjectId] = useState('')
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
  const compareCriteria = 'Research objective, Methodology, Algorithm, Dataset, Model, Evaluation metrics, Results, Limitations, Future work'
  const comparisonPrompt = 'Compare the selected research papers across research objectives, methodology, algorithms, datasets, models, evaluation metrics, results, limitations, and future work. Populate each field only from the supplied papers. Use “Not found in document” when evidence is missing. Identify similarities, disagreements, unique contributions, and potential evidence-supported research gaps. Cite exact short excerpts and page numbers when available. Do not infer unsupported facts or claim global novelty.'
  const promptStarters = [
    {
      label: 'Full literature review',
      prompt: 'Analyze the selected papers as a connected body of literature. For each paper, summarize its research objective, contribution, methodology, model or algorithm, dataset, evaluation metrics, key results, limitations, and stated future work. Compare agreements, disagreements, and trade-offs across papers. Identify recurring limitations and candidate research gaps only when supported by evidence in these sources; explain counter-evidence and uncertainty. Propose specific, feasible research questions and next steps. Cite short exact excerpts with paper titles and page numbers when available. Separate source facts from interpretation, mark missing information as “Not found in document,” and do not claim the gaps are globally novel.'
    },
    {
      label: 'Compare methods and results',
      prompt: 'Compare the selected papers by research objective, study design, methodology, model or algorithm, data and sample, evaluation metrics, and results. Explain meaningful similarities, differences, and trade-offs; do not treat text similarity as proof of equivalent contributions. Identify which claims are directly supported by each paper, note missing or conflicting evidence, and cite short exact excerpts with paper titles and page numbers when available. Conclude with limitations and practical implications. Use “Not found in document” rather than guessing, and do not claim worldwide novelty.'
    },
    {
      label: 'Find evidence-based gaps',
      prompt: 'Review the selected papers for recurring limitations, underexplored populations or datasets, methodological weaknesses, missing evaluations, and explicitly stated future work. Report only candidate gaps that can be supported by exact evidence from these papers. For each candidate, explain why it may matter, which papers support it, relevant counter-evidence, confidence, and uncertainty. Suggest a feasible research direction and a testable research question for each. Cite short exact excerpts with page numbers when available. Distinguish an omission in this selected set from a gap in the wider literature; do not claim global novelty.'
    },
  ]
  const togglePaper = (id: string) => setSelected((current) => {
    if (current.includes(id)) return current.filter((entry) => entry !== id)
    if (current.length >= (compareMode ? 5 : 10)) return current
    return [...current, id]
  })
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
      const response = await onAnalyze({ prompt: compareMode ? comparisonPrompt : prompt, paper_ids: selected, project_id: projectId || null, document_ids: selectedDocuments, mode, criteria: (compareMode ? compareCriteria : criteria).split(',').map((item) => item.trim()).filter(Boolean), questions: questions.split('\n').map((item) => item.trim()).filter(Boolean), report_format: format })
      setResult(response)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false); setReview(false) }
  }
  return <>
    <PageHeading eyebrow="RESEARCH ANALYSIS WORKSPACE" title={compareMode ? 'Compare research papers' : 'Custom research analysis'} description="Choose a workflow below. Both modes stay in this workspace and use the same selected papers and live results." />
    <div className="analysis-mode-tabs" role="tablist" aria-label="Analysis workflow">
      <button className={compareMode ? 'active' : ''} role="tab" aria-selected={compareMode} onClick={() => setSearchParams({ tab: 'compare' })}><FlaskConical size={15} /> Compare papers</button>
      <button className={!compareMode ? 'active' : ''} role="tab" aria-selected={!compareMode} onClick={() => setSearchParams({ tab: 'custom' })}><Sparkles size={15} /> Custom analysis</button>
    </div>
    <div className={`analysis-layout ${compareMode ? 'comparison-workspace' : ''}`}>
      <div className="analysis-form">
        <section className="panel form-section"><div className="section-heading"><span className="section-number">01</span><div><h2>{compareMode ? 'Select 2–5 papers to compare' : 'Choose your papers'}</h2><p>{compareMode ? 'Choose between two and five papers. Selection order is shown on each card.' : 'Select up to ten papers from your library.'}</p></div><span className="selection-count">{selected.length} selected</span></div>
          {papers.length === 0 ? <div className="paper-empty"><BookOpen size={19} /><div><b>Your library is empty</b><span>Upload research papers before starting an analysis.</span></div><NavLink to="/upload" className="text-link">Upload papers <ArrowRight size={13} /></NavLink></div> : <div className={compareMode ? 'compare-paper-grid' : 'select-paper-list'}>{papers.map((paper) => {
            const selectionNumber = selected.indexOf(paper.id)
            const selectionLocked = !selected.includes(paper.id) && selected.length >= (compareMode ? 5 : 10)
            return <label className={`${compareMode ? 'compare-paper-card' : 'select-paper'} ${selected.includes(paper.id) ? 'selected' : ''} ${selectionLocked ? 'selection-locked' : ''}`} key={paper.id}>
              <input type="checkbox" checked={selectionNumber >= 0} disabled={selectionLocked} onChange={() => togglePaper(paper.id)} />
              {compareMode && <span className="compare-card-number">{selectionNumber >= 0 ? selectionNumber + 1 : ''}</span>}
              {compareMode ? <span className="compare-card-icon"><FileText size={16} /></span> : <><span className="paper-checkbox">{selectionNumber >= 0 && <Check size={13} />}</span><FileText size={17} className="select-paper-icon" /></>}
              <span className="select-paper-info"><b>{paper.title}</b><small>{paper.filename} · {paper.page_count} pages · {paper.word_count.toLocaleString()} words</small></span>
              {compareMode && <span className="compare-paper-topic">{Object.keys(paper.sections || {}).slice(0, 2).map((section) => section.replace(/_/g, ' ')).join(' · ') || 'Paper from your library'}</span>}
            </label>
          })}</div>}
          {compareMode && selected.length > 0 && selected.length < 2 && <p className="comparison-hint">Select at least one more paper to compare.</p>}
        </section>
        {!compareMode && <section className="panel form-section"><div className="section-heading"><span className="section-number">02</span><div><h2>Write your analysis prompt</h2><p>Tell ResearchLens what to focus on. Your instructions are combined with evidence and safety rules.</p></div></div>
          <textarea className="prompt-area" value={prompt} maxLength={4000} onChange={(event) => setPrompt(event.target.value)} placeholder="Compare these papers on [your topic]. Focus on the algorithms used, datasets, evaluation metrics, limitations, and unresolved problems. Identify potential research gaps supported by evidence from the uploaded papers and suggest feasible research questions." />
          <div className="field-foot"><span>Be specific about scope, comparisons, and outputs.</span><span>{prompt.length}/4,000</span></div>
          <div className="quick-prompt"><span>Prompt starters:</span>{promptStarters.map((starter) => <button key={starter.label} onClick={() => setPrompt(starter.prompt)}>{starter.label} <ArrowRight size={12} /></button>)}</div>
        </section>}
        <section className="panel form-section"><div className="section-heading"><span className="section-number">+</span><div><h2>Supporting documents</h2><p>Optionally include guidelines, notes, datasets, or references as additional context.</p></div></div>
          <label className="support-upload">{documentBusy ? <><span className="spinner purple-spinner" /> Adding document…</> : <><FilePlus2 size={15} /> Add PDF, TXT, Markdown, or CSV<input type="file" accept=".pdf,.txt,.md,.csv,application/pdf,text/plain,text/markdown,text/csv" multiple onChange={(event) => { void uploadDocuments(event.target.files); event.target.value = '' }} /></>}</label>
          {documents.length > 0 && <div className="support-list">{documents.map((document) => <label className={`support-row ${selectedDocuments.includes(document.id) ? 'selected' : ''}`} key={document.id}><input type="checkbox" checked={selectedDocuments.includes(document.id)} onChange={() => toggleDocument(document.id)} /><span className="paper-checkbox">{selectedDocuments.includes(document.id) && <Check size={13} />}</span><FileText size={15} /><span><b>{document.filename}</b><small>{document.word_count.toLocaleString()} words</small></span></label>)}</div>}
        </section>
        <section className="panel form-section"><div className="section-heading"><span className="section-number">{compareMode ? '02' : '03'}</span><div><h2>{compareMode ? 'Comparison options' : 'Shape your output'}</h2><p>{compareMode ? 'Compare evidence fields and identify candidate gaps from selected papers.' : 'Adjust the analysis mode and add domain-specific criteria.'}</p></div></div>
          {projects.length > 0 && <label className="field-label project-analysis-select">Save to project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">No project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
          <div className="two-fields"><label className="field-label">Analysis mode<select value={mode} onChange={(event) => setMode(event.target.value)}><option value="comprehensive">Comprehensive comparison</option><option value="similarity">Similarity and differences</option><option value="gaps">Research-gap discovery</option><option value="individual">Individual paper summaries</option></select></label><label className="field-label">Report format<select value={format} onChange={(event) => setFormat(event.target.value)}><option value="detailed">Detailed report</option><option value="concise">Concise summary</option><option value="table">Comparison-first</option></select></label></div>
          {!compareMode && <label className="field-label criteria-field">Custom comparison criteria<input value={criteria} onChange={(event) => setCriteria(event.target.value)} placeholder="Separate criteria with commas" /></label>}
          <label className="field-label">Domain-specific questions<textarea className="questions-area" value={questions} onChange={(event) => setQuestions(event.target.value)} placeholder={'One question per line (optional)\nWhich dataset is used most often?\nHow are the results evaluated?'} /></label>
        </section>
        <div className="analysis-submit-row"><div><ShieldCheck size={16} /><span>Paper content is treated as untrusted source material.</span></div><button className="button primary" disabled={busy || (compareMode ? selected.length < 2 : !selected.length || prompt.trim().length < 5)} onClick={() => setReview(true)}><Sparkles size={16} /> {compareMode ? 'Compare selected papers' : 'Review analysis'}</button></div>
        {error && <div className="inline-error" role="alert"><X size={16} />{error}</div>}
        {result && <Results analysis={result} onDownloadReport={onDownloadReport} />}
      </div>
      <aside className="analysis-aside"><div className="panel workflow-panel"><span className="eyebrow">YOUR WORKFLOW</span><h2>From papers to perspective</h2><div className="workflow-step"><span>1</span><div><b>Read your sources</b><small>PDF text and likely section headings are extracted locally.</small></div></div><div className="workflow-step"><span>2</span><div><b>Follow your prompt</b><small>Your focus guides the analysis of the selected papers.</small></div></div><div className="workflow-step"><span>3</span><div><b>Check the evidence</b><small>Potential gaps are returned only with matching source excerpts.</small></div></div></div><div className="panel analysis-note"><div className="tiny-icon"><ShieldCheck size={16} /></div><b>Interpret with care</b><p>Candidate gaps reflect only the papers you selected. They do not establish that a topic is globally novel or unexplored.</p></div></aside>
    </div>
    {review && <div className="modal-scrim" role="presentation"><div className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title"><div className="modal-heading"><div><span className="eyebrow">FINAL CHECK</span><h2 id="review-title">{compareMode ? 'Review your comparison' : 'Review your analysis'}</h2></div><button className="icon-button" onClick={() => setReview(false)} aria-label="Close"><X size={18} /></button></div><p className="review-label">PAPERS ({selected.length})</p><div className="review-papers">{papers.filter((paper) => selected.includes(paper.id)).map((paper) => <span key={paper.id}><FileText size={14} />{paper.title}</span>)}</div>{selectedDocuments.length > 0 && <><p className="review-label">SUPPORTING DOCUMENTS ({selectedDocuments.length})</p><div className="review-papers">{documents.filter((document) => selectedDocuments.includes(document.id)).map((document) => <span key={document.id}><FileText size={14} />{document.filename}</span>)}</div></>}<p className="review-label">{compareMode ? 'COMPARISON SCOPE' : 'YOUR PROMPT'}</p><div className="review-prompt">{compareMode ? comparisonPrompt : prompt}</div><p className="review-label">MODE · {mode.replace('-', ' ')} · {format} report</p><div className="modal-actions"><button className="button secondary" onClick={() => setReview(false)}>Back to edit</button><button className="button primary" disabled={busy} onClick={submit}>{busy ? <><span className="spinner" /> Starting…</> : <><Sparkles size={15} /> Start analysis</>}</button></div></div></div>}
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
    <GapDiscovery gaps={result.research_gaps || []} demoMode={Boolean(result.demo_mode)} />
    {['repeated_limitations', 'research_questions', 'future_directions', 'limitations'].map((key) => result[key]?.length > 0 && <div className="result-card" key={key}><h3>{key.replace(/_/g, ' ').replace(/^\w/, (letter: string) => letter.toUpperCase())}</h3>{result[key].map((item: any, index: number) => <StructuredItem key={index} item={item} />)}</div>)}
  </section>
}

function ResearchGapsPage({ analyses }: { analyses: Analysis[] }) {
  const [category, setCategory] = useState('All')
  const colors = ['#1474d4', '#10a7a0', '#f0a23a', '#7865d5', '#e46e61', '#438a63', '#48a8ce']
  const gaps = analyses.flatMap((analysis) =>
    (analysis.result.research_gaps || []).map((gap: any) => ({
      analysis,
      gap,
      category: typeof gap.category === 'string' && gap.category.trim()
        ? gap.category.trim()
        : researchGapCategory(gap.title),
    })),
  )
  const categories = [...new Set(gaps.map((entry) => entry.category))].sort()
  const visibleGaps = category === 'All' ? gaps : gaps.filter((entry) => entry.category === category)
  const highPriority = gaps.filter(({ gap }) => typeof gap.confidence === 'number' && gap.confidence >= 0.8).length
  const confidenceValues = gaps
    .map(({ gap }) => gap.confidence)
    .filter((confidence): confidence is number => typeof confidence === 'number')
  const averageConfidence = confidenceValues.length
    ? Math.round(confidenceValues.reduce((sum, confidence) => sum + confidence, 0) / confidenceValues.length * 100)
    : 0
  const distribution = categories.map((name, index) => ({
    name,
    count: gaps.filter((entry) => entry.category === name).length,
    color: colors[index % colors.length],
  }))
  let angle = 0
  const donut = distribution.length
    ? distribution.map((entry) => {
      const start = angle
      angle += entry.count / gaps.length * 360
      return `${entry.color} ${start}deg ${angle}deg`
    }).join(', ')
    : '#e9edf2 0deg 360deg'
  const directions = analyses.flatMap((analysis) =>
    (analysis.result.future_directions || []).map((item: any) => ({
      text: typeof item === 'string' ? item : item.description || item.title || item.direction || '',
      analysis,
    })),
  ).filter((item) => item.text).slice(0, 5)

  return <>
    <PageHeading eyebrow="EVIDENCE-LINKED DISCOVERY" title="Research gap discovery" description="Explore candidate gaps identified across your saved analyses. Every gap is scoped to the papers you reviewed, with evidence and uncertainty kept visible." action={<NavLink to="/analysis" className="button primary"><Sparkles size={15} /> Run an analysis</NavLink>} />
    <section className="gap-overview-metrics">
      <Metric icon={<Lightbulb size={17} />} label="Candidate gaps" value={gaps.length.toString()} note="Across saved analyses" color="blue" />
      <Metric icon={<ShieldCheck size={17} />} label="High confidence" value={highPriority.toString()} note="Confidence of 80% or higher" color="purple" />
      <Metric icon={<BookOpen size={17} />} label="Research areas" value={categories.length.toString()} note="Evidence-derived categories" color="green" />
      <Metric icon={<ChartNoAxesCombined size={17} />} label="Average confidence" value={`${averageConfidence}%`} note={confidenceValues.length ? 'Across scored candidates' : 'No scored candidates yet'} color="amber" />
    </section>
    <div className="gap-discovery-layout">
      <div className="gap-discovery-main">
        <section className="panel gap-results-panel">
          <div className="panel-heading"><div><span className="eyebrow">SAVED FINDINGS</span><h2>Potential research gaps</h2></div><span className="library-total">{visibleGaps.length} shown</span></div>
          <div className="gap-filter-row"><button className={category === 'All' ? 'active' : ''} onClick={() => setCategory('All')}>All <span>{gaps.length}</span></button>{categories.map((name) => <button key={name} className={category === name ? 'active' : ''} onClick={() => setCategory(name)}>{name} <span>{gaps.filter((entry) => entry.category === name).length}</span></button>)}</div>
          {visibleGaps.length ? <div className="gap-card-grid">{visibleGaps.map(({ analysis, gap, category: gapCategory }, index) => {
            const papers = analysis.result.papers_analyzed || []
            const evidence = Array.isArray(gap.evidence) ? gap.evidence : []
            const paperTitles = [...new Set<string>(evidence.map((item: any) => item.paper_title).filter((title: unknown): title is string => typeof title === 'string' && title.length > 0))]
            return <article className="gap-research-card discovery-gap-card" key={`${analysis.id}-${index}`}>
              <div className="gap-card-meta"><span>{gapCategory}</span><b className={typeof gap.confidence === 'number' && gap.confidence >= 0.8 ? 'priority-high' : ''}>{typeof gap.confidence === 'number' ? `${Math.round(gap.confidence * 100)}% confidence` : 'Candidate'}</b></div>
              <h3>{gap.title || 'Potential research gap'}</h3>
              <p>{gap.description || 'Review the cited evidence and analysis context for details.'}</p>
              {paperTitles.length > 0 && <div className="gap-supporting-papers"><small>SUPPORTING PAPERS</small><div>{paperTitles.map((title: string) => <span key={title}>{title}</span>)}</div></div>}
              {gap.suggested_direction && <div className="gap-direction"><Sparkles size={13} /><div><b>Suggested research direction</b><span>{gap.suggested_direction}</span></div></div>}
              <details className="gap-evidence-details"><summary>View evidence ({evidence.length} sources)<ChevronDown size={14} /></summary>
                {evidence.map((source: any, sourceIndex: number) => <blockquote key={`${source.paper_id}-${sourceIndex}`}><p>“{source.excerpt}”</p><cite>{source.paper_title}{source.page_number ? ` · p. ${source.page_number}` : ''}</cite></blockquote>)}
                {gap.uncertainty && <p className="uncertainty"><b>Uncertainty:</b> {gap.uncertainty}</p>}
                {gap.counter_evidence?.length > 0 && <p className="gap-counter-evidence"><b>Counter-evidence:</b> {gap.counter_evidence.join(' ')}</p>}
              </details>
              <div className="gap-result-footer"><span>{papers.length} source {papers.length === 1 ? 'paper' : 'papers'} · {new Date(analysis.created_at).toLocaleDateString()}</span><NavLink to={`/results/${analysis.id}`}>View full analysis <ArrowRight size={13} /></NavLink></div>
            </article>
          })}</div> : <div className="gaps-empty-state"><Lightbulb size={22} /><h3>{gaps.length ? 'No gaps in this category' : 'No saved research gaps yet'}</h3><p>{gaps.length ? 'Choose another category to see its findings.' : 'Run a comprehensive or research-gap analysis on your papers. Candidate gaps appear here only when the analysis has supporting evidence.'}</p>{!gaps.length && <NavLink to="/analysis" className="button secondary">Start evidence-based analysis <ArrowRight size={14} /></NavLink>}</div>}
        </section>
      </div>
      <aside className="gap-discovery-aside">
        <section className="panel gap-distribution-panel"><div className="panel-heading"><div><span className="eyebrow">OVERVIEW</span><h2>Gap distribution</h2></div></div>
          {distribution.length ? <><div className="gap-donut" style={{ background: `conic-gradient(${donut})` }}><span>{gaps.length}<small>gaps</small></span></div><div className="gap-legend">{distribution.map((entry) => <div key={entry.name}><span style={{ background: entry.color }} />{entry.name}<b>{entry.count}</b></div>)}</div></> : <p className="gap-aside-empty">Category counts will appear after an analysis identifies evidence-supported candidates.</p>}
        </section>
        <section className="panel gap-directions-panel"><div className="panel-heading"><div><span className="eyebrow">NEXT STEPS</span><h2>Recommended directions</h2></div></div>
          {directions.length ? <ol>{directions.map((direction, index) => <li key={`${direction.analysis.id}-${index}`}><span>{index + 1}</span><div><p>{direction.text}</p><NavLink to={`/results/${direction.analysis.id}`}>Source analysis <ArrowRight size={12} /></NavLink></div></li>)}</ol> : <p className="gap-aside-empty">Research directions from completed analyses will appear here.</p>}
        </section>
        <div className="gap-scope-note"><ShieldCheck size={16} /><p><b>Interpret with care</b> These are candidates based on your selected papers, not proof of worldwide novelty. Review the supporting passages and counter-evidence before drawing conclusions.</p></div>
      </aside>
    </div>
  </>
}

function researchGapCategory(title: unknown) {
  const text = String(title || '').toLowerCase()
  if (text.includes('dataset') || text.includes('data set')) return 'Dataset'
  if (text.includes('method') || text.includes('approach')) return 'Methodology'
  if (text.includes('scale') || text.includes('latency')) return 'Scalability'
  if (text.includes('explain')) return 'Explainability'
  if (text.includes('evaluat') || text.includes('metric')) return 'Evaluation'
  if (text.includes('future')) return 'Future work'
  return 'Other'
}

function GapDiscovery({ gaps, demoMode }: { gaps: any[]; demoMode: boolean }) {
  const [category, setCategory] = useState('All')
  const categories = [...new Set(gaps.map((gap) => {
    if (typeof gap.category === 'string' && gap.category.trim()) return gap.category.trim()
    const title = String(gap.title || '').toLowerCase()
    if (title.includes('dataset') || title.includes('data set')) return 'Dataset'
    if (title.includes('method') || title.includes('approach')) return 'Methodology'
    if (title.includes('scale') || title.includes('latency')) return 'Scalability'
    if (title.includes('explain')) return 'Explainability'
    if (title.includes('evaluat') || title.includes('metric')) return 'Evaluation'
    if (title.includes('future')) return 'Future work'
    return 'Other'
  }))].sort()
  const averageConfidence = gaps.length
    ? Math.round(gaps.reduce((total, gap) => total + (typeof gap.confidence === 'number' ? gap.confidence : 0), 0) / gaps.length * 100)
    : 0
  const visibleGaps = gaps.filter((gap) => {
    const title = String(gap.title || '').toLowerCase()
    const itemCategory = typeof gap.category === 'string' && gap.category.trim()
      ? gap.category.trim()
      : title.includes('dataset') || title.includes('data set') ? 'Dataset'
        : title.includes('method') || title.includes('approach') ? 'Methodology'
          : title.includes('scale') || title.includes('latency') ? 'Scalability'
            : title.includes('explain') ? 'Explainability'
              : title.includes('evaluat') || title.includes('metric') ? 'Evaluation'
                : title.includes('future') ? 'Future work' : 'Other'
    return category === 'All' || itemCategory === category
  })
  return <section className="result-card gap-discovery"><div className="gap-heading"><div><span className="eyebrow">EVIDENCE FROM SELECTED PAPERS</span><h3>Potential research gaps</h3><p>These candidates reflect only your uploaded selection; they are not claims of global novelty.</p></div></div>
    {gaps.length > 0 && <><div className="gap-metrics"><div><small>Potential gaps</small><b>{gaps.length}</b></div><div><small>Higher confidence (≥75%)</small><b>{gaps.filter((gap) => typeof gap.confidence === 'number' && gap.confidence >= 0.75).length}</b></div><div><small>Categories</small><b>{categories.length}</b></div><div><small>Mean confidence</small><b>{averageConfidence}%</b></div></div><div className="gap-filter-row"><button className={category === 'All' ? 'active' : ''} onClick={() => setCategory('All')}>All ({gaps.length})</button>{categories.map((item) => <button className={category === item ? 'active' : ''} key={item} onClick={() => setCategory(item)}>{item} ({gaps.filter((gap) => {
      const title = String(gap.title || '').toLowerCase()
      const normalized = typeof gap.category === 'string' && gap.category.trim() ? gap.category.trim() : title.includes('dataset') || title.includes('data set') ? 'Dataset' : title.includes('method') || title.includes('approach') ? 'Methodology' : title.includes('scale') || title.includes('latency') ? 'Scalability' : title.includes('explain') ? 'Explainability' : title.includes('evaluat') || title.includes('metric') ? 'Evaluation' : title.includes('future') ? 'Future work' : 'Other'
      return normalized === item
    }).length})</button>)}</div><div className="gap-card-grid">{visibleGaps.map((gap, index) => <article className="gap-research-card" key={`${gap.title}-${index}`}><div className="gap-card-meta"><span>{typeof gap.category === 'string' ? gap.category : categories.find((item) => {
      const title = String(gap.title || '').toLowerCase()
      return item === (title.includes('dataset') ? 'Dataset' : title.includes('method') ? 'Methodology' : title.includes('scale') ? 'Scalability' : title.includes('explain') ? 'Explainability' : title.includes('evaluat') ? 'Evaluation' : title.includes('future') ? 'Future work' : 'Other')
    }) || 'Other'}</span><b>{typeof gap.confidence === 'number' ? `${Math.round(gap.confidence * 100)}% confidence` : 'Candidate'}</b></div><h4>{gap.title || 'Potential gap'}</h4><p>{gap.description}</p>{gap.suggested_direction && <div className="gap-direction"><Sparkles size={13} /><div><b>Suggested direction</b><span>{gap.suggested_direction}</span></div></div>}<details className="gap-evidence-details"><summary>View evidence ({gap.evidence?.length || 0} sources)<ChevronDown size={14} /></summary>{gap.evidence?.map((evidence: any, evidenceIndex: number) => <blockquote key={`${evidence.paper_id}-${evidenceIndex}`}><p>“{evidence.excerpt}”</p><cite>{evidence.paper_title}{evidence.page_number ? ` · p. ${evidence.page_number}` : ''}</cite></blockquote>)}{gap.uncertainty && <p className="uncertainty"><b>Uncertainty:</b> {gap.uncertainty}</p>}{gap.counter_evidence?.length > 0 && <p className="gap-counter-evidence"><b>Counter-evidence:</b> {gap.counter_evidence.join(' ')}</p>}</details></article>)}</div></>}
    {!gaps.length && <div className="no-gaps"><ShieldCheck size={18} /><span>{demoMode ? 'Research-gap discovery requires live Gemini analysis. No gaps were generated in local mode.' : 'No evidence-supported gaps were identified in the selected papers.'}</span></div>}
  </section>
}

function StructuredItem({ item }: { item: any }) {
  return <div className="structured-item"><b>{typeof item === 'string' ? item : item.title || item.name || item.question || 'Finding'}</b>{item.description && <p>{item.description}</p>}{item.evidence?.map((evidence: any, index: number) => <blockquote key={index}><p>“{evidence.excerpt}”</p><cite>{evidence.paper_title}{evidence.page_number ? ` · p. ${evidence.page_number}` : ''}</cite></blockquote>)}</div>
}

function ComparisonMatrix({ comparison, papers }: { comparison: any[]; papers: any[] }) {
  return <div className="comparison-table-wrap"><table className="comparison-table"><thead><tr><th>Criterion</th>{papers.map((paper) => <th key={paper.paper_id}>{paper.title}</th>)}</tr></thead><tbody>{comparison.filter((item) => item?.criterion && Array.isArray(item.findings)).map((item, index) => <tr key={`${item.criterion}-${index}`}><th>{item.criterion}</th>{papers.map((paper) => <td key={paper.paper_id}>{item.findings.find((finding: any) => finding.paper_id === paper.paper_id)?.finding || 'Not found in document'}</td>)}</tr>)}</tbody></table></div>
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
        ...papers.map((paper) => item.findings.find((finding: any) => finding.paper_id === paper.paper_id)?.finding || 'Not found in document'),
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

function SettingsPage({ aiEnabled, userEmail, authenticated }: { aiEnabled: boolean; userEmail: string; authenticated: boolean }) {
  return <>
    <PageHeading eyebrow="ACCOUNT & CONFIGURATION" title="Settings" description="Review your account, AI connection, privacy boundaries, and server-side configuration." />
    <div className="settings-layout">
      <section className="panel settings-card">
        <div className="panel-heading"><div><span className="eyebrow">ACCOUNT</span><h2>{authenticated ? 'Google account' : 'Local workspace'}</h2></div><div className={`metric-icon ${authenticated ? 'green' : 'blue'}`}><ShieldCheck size={18} /></div></div>
        <div className="settings-detail-row"><span>Signed in as</span><b>{userEmail || 'Local account on this deployment'}</b></div>
        <div className="settings-detail-row"><span>Access mode</span><b>{authenticated ? 'Google sign-in and allowlist enabled' : 'Local account mode'}</b></div>
        <div className="settings-detail-row"><span>AI provider</span><b>{aiEnabled ? 'Gemini configured on backend' : 'Local demo mode'}</b></div>
        <div className="settings-divider" />
        <span className="eyebrow">PRIVACY & DATA</span>
        <div className="security-callout"><ShieldCheck size={17} /><div><b>API credentials stay on the server</b><span>ResearchLens does not expose Gemini API keys to the browser. If Gemini is enabled, selected paper text is sent to the configured provider for analysis.</span></div></div>
        <ul className="settings-bullets"><li>Paper text and analysis results are stored in the configured database.</li><li>Uploaded PDF binaries are extracted during upload and are not retained by this service.</li><li>Deleting a paper removes it from the library; saved analysis reports remain part of analysis history.</li></ul>
      </section>
      <section className="panel config-card">
        <div className="tiny-icon"><Settings size={16} /></div><span className="eyebrow">SERVER CONFIGURATION</span><h2>Environment variables</h2>
        <div className="config-row"><code>GEMINI_API_KEY</code><span>{aiEnabled ? 'Configured (value hidden)' : 'Not configured'}</span></div>
        <div className="config-row"><code>GEMINI_MODEL</code><span>Set by backend operator</span></div>
        <div className="config-row"><code>GEMINI_EMBEDDING_MODEL</code><span>Set by backend operator</span></div>
        <div className="config-row"><code>MAX_UPLOAD_MB</code><span>Backend default: 25 MB</span></div>
        <p className="config-footnote">For Render, update API variables in the Render service dashboard. For local development, update the root .env and restart the backend. Settings are intentionally read-only here so secrets cannot be changed through the browser.</p>
        <a className="button secondary settings-link" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Manage Gemini API key <ArrowRight size={14} /></a>
      </section>
    </div>
  </>
}

function EmptyState({ icon, title, detail, link, linkText }: { icon: ReactNode; title: string; detail: string; link: string; linkText: string }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{detail}</p><NavLink to={link} className="button secondary">{linkText}<ArrowRight size={14} /></NavLink></div>
}

export default App
