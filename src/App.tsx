/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Server,
  Cloud,
  Terminal,
  FileArchive,
  Github,
  Key,
  Globe,
  BarChart3,
  Settings,
  BookOpen,
  LogOut,
  User,
  Plus,
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  RotateCcw,
  Trash2,
  Copy,
  ExternalLink,
  Shield,
  Zap,
  Cpu,
  HardDrive,
  Activity,
  Lock,
  ChevronRight,
  ArrowRight,
  RefreshCw,
  FolderTree,
  UploadCloud,
  Code2,
  Check,
  X,
  Menu,
  Sliders,
  HelpCircle,
  Database,
  Layers,
  Sparkles,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import {
  SUPPORTED_FRAMEWORKS,
  SPIDYY_LIMITS,
} from '../packages/shared/constants.ts';
import type {
  UserDTO,
  ProjectDTO,
  DeploymentDTO,
  DeploymentTokenDTO,
  DomainDTO,
  EnvVarDTO,
  AccountUsageDTO,
  AuditLogDTO,
} from '../packages/shared/types.ts';
import { spidyyApi, setCsrfToken } from './lib/api.ts';
import { extractAndValidateZipInBrowser, buildSampleStaticSiteZip } from './lib/zip.ts';

export default function App() {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Active Nav View
  const [activeTab, setActiveTab] = useState<
    | 'landing'
    | 'dashboard'
    | 'projects'
    | 'project-detail'
    | 'deployments'
    | 'deployment-detail'
    | 'domains'
    | 'env'
    | 'analytics'
    | 'settings'
    | 'docs'
  >('landing');

  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null);
  const [deployments, setDeployments] = useState<DeploymentDTO[]>([]);
  const [selectedDeploymentData, setSelectedDeploymentData] = useState<{
    deployment: DeploymentDTO;
    files: Array<{ filePath: string; sizeBytes: number }>;
  } | null>(null);

  // Modals & wizards
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showZipUploadModal, setShowZipUploadModal] = useState(false);
  const [showGithubModal, setShowGithubModal] = useState(false);
  const [showDomainModal, setShowDomainModal] = useState(false);
  const [showEnvModal, setShowEnvModal] = useState(false);

  // New project form state
  const [newProjName, setNewProjName] = useState('');
  const [newProjSlug, setNewProjSlug] = useState('');
  const [newProjFramework, setNewProjFramework] = useState('static');
  const [newProjRepoUrl, setNewProjRepoUrl] = useState('');
  const [newProjRepoBranch, setNewProjRepoBranch] = useState('main');
  const [newProjBuildCmd, setNewProjBuildCmd] = useState('');
  const [newProjOutputDir, setNewProjOutputDir] = useState('dist');
  const [newProjCreating, setNewProjCreating] = useState(false);
  const [newProjError, setNewProjError] = useState<string | null>(null);

  // ZIP upload state
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipExtracting, setZipExtracting] = useState(false);
  const [zipReport, setZipReport] = useState<Awaited<ReturnType<typeof extractAndValidateZipInBrowser>> | null>(null);
  const [zipUploading, setZipUploading] = useState(false);
  const [zipUploadProgress, setZipUploadProgress] = useState(0);
  const [zipUploadStatusText, setZipUploadStatusText] = useState('');

  // GitHub token state
  const [githubTokens, setGithubTokens] = useState<DeploymentTokenDTO[]>([]);
  const [githubWorkflowYaml, setGithubWorkflowYaml] = useState('');
  const [newlyGeneratedToken, setNewlyGeneratedToken] = useState<string | null>(null);

  // Domains & Env state
  const [domains, setDomains] = useState<DomainDTO[]>([]);
  const [newDomainHost, setNewDomainHost] = useState('');
  const [envVars, setEnvVars] = useState<EnvVarDTO[]>([]);
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvVal, setNewEnvVal] = useState('');
  const [newEnvTarget, setNewEnvTarget] = useState<'production' | 'preview'>('production');

  // Usage & analytics
  const [accountUsage, setAccountUsage] = useState<AccountUsageDTO | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogDTO[]>([]);

  // Account settings state
  const [settingName, setSettingName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [settingMessage, setSettingMessage] = useState<string | null>(null);

  // Mobile drawer state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    spidyyApi
      .me()
      .then((res) => {
        setUser(res.user);
        setSettingName(res.user.name);
        setCsrfToken(res.csrfToken);
        setActiveTab('dashboard');
        loadDashboardData();
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setLoadingUser(false);
      });
  }, []);

  async function loadDashboardData() {
    try {
      const [projRes, depRes, usageRes, domRes, auditRes] = await Promise.all([
        spidyyApi.listProjects(),
        spidyyApi.listAllDeployments(),
        spidyyApi.getAccountUsage(),
        spidyyApi.listAllDomains(),
        spidyyApi.getAuditLogs(),
      ]);
      setProjects(projRes.projects);
      setDeployments(depRes.deployments);
      setAccountUsage(usageRes.usage);
      setDomains(domRes.domains);
      setAuditLogs(auditRes.logs);
    } catch {
      // Background load error handler
    }
  }

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      let res;
      if (authMode === 'login') {
        res = await spidyyApi.login({ email: authEmail, password: authPassword });
      } else {
        res = await spidyyApi.register({
          name: authName || authEmail.split('@')[0],
          email: authEmail,
          password: authPassword,
        });
      }
      setUser(res.user);
      setSettingName(res.user.name);
      setCsrfToken(res.csrfToken);
      setActiveTab('dashboard');
      loadDashboardData();
    } catch (err: any) {
      setAuthError(err.message || 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await spidyyApi.logout();
    } catch {
      // Ignore
    }
    setUser(null);
    setActiveTab('landing');
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    setNewProjError(null);
    setNewProjCreating(true);
    try {
      const fw = SUPPORTED_FRAMEWORKS.find((f) => f.id === newProjFramework);
      const res = await spidyyApi.createProject({
        name: newProjName,
        slug: newProjSlug || undefined,
        framework: newProjFramework,
        repoUrl: newProjRepoUrl || undefined,
        repoBranch: newProjRepoBranch || 'main',
        buildCommand: newProjBuildCmd || fw?.defaultBuildCommand || '',
        outputDir: newProjOutputDir || fw?.defaultOutputDir || 'dist',
        spaFallback: true,
      });
      setShowNewProjectModal(false);
      setNewProjName('');
      setNewProjSlug('');
      setNewProjRepoUrl('');
      loadDashboardData();
      openProject(res.project.id);
    } catch (err: any) {
      setNewProjError(err.message || 'Failed to create project');
    } finally {
      setNewProjCreating(false);
    }
  }

  async function openProject(projectId: string) {
    setSelectedProjectId(projectId);
    setActiveTab('project-detail');
    try {
      const [depRes, tokRes, domRes, envRes] = await Promise.all([
        spidyyApi.listProjectDeployments(projectId),
        spidyyApi.listProjectTokens(projectId),
        spidyyApi.listProjectDomains(projectId),
        spidyyApi.listProjectEnvVars(projectId),
      ]);
      setDeployments(depRes.deployments);
      setGithubTokens(tokRes.tokens);
      setDomains(domRes.domains);
      setEnvVars(envRes.envVars);
      const wf = await spidyyApi.getProjectWorkflow(projectId);
      setGithubWorkflowYaml(wf.yaml);
    } catch {
      // Ignored
    }
  }

  async function openDeployment(deploymentId: string) {
    setSelectedDeploymentId(deploymentId);
    setActiveTab('deployment-detail');
    try {
      const res = await spidyyApi.getDeployment(deploymentId);
      setSelectedDeploymentData(res);
    } catch {
      setSelectedDeploymentData(null);
    }
  }

  async function handleDownloadSampleZip() {
    if (!selectedProjectId) return;
    const proj = projects.find((p) => p.id === selectedProjectId);
    if (!proj) return;
    const file = await buildSampleStaticSiteZip(proj.name, proj.slug);
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleZipFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setZipFile(file);
    setZipExtracting(true);
    setZipReport(null);
    try {
      const report = await extractAndValidateZipInBrowser(file);
      setZipReport(report);
    } catch (err: any) {
      setZipReport({
        valid: false,
        files: [],
        totalBytes: 0,
        hasIndexHtml: false,
        skippedSystemFiles: [],
        errors: [err.message || 'Failed to extract ZIP'],
      });
    } finally {
      setZipExtracting(false);
    }
  }

  async function executeZipDeployment() {
    if (!selectedProjectId || !zipReport || !zipReport.valid) return;
    setZipUploading(true);
    setZipUploadProgress(0);
    setZipUploadStatusText('Initializing deployment...');
    try {
      const initRes = await spidyyApi.createDeployment({
        projectId: selectedProjectId,
        source: 'zip',
        expectedFileCount: zipReport.files.length,
        expectedTotalBytes: zipReport.totalBytes,
      });
      const depId = initRes.deployment.id;
      let uploadedCount = 0;
      for (const f of zipReport.files) {
        uploadedCount++;
        const pct = Math.round((uploadedCount / zipReport.files.length) * 85);
        setZipUploadProgress(pct);
        setZipUploadStatusText(`Uploading (${uploadedCount}/${zipReport.files.length}): ${f.path}`);
        await spidyyApi.uploadDeploymentFile(depId, f.path, f.data);
      }
      setZipUploadProgress(95);
      setZipUploadStatusText('Verifying index.html and finalizing deployment...');
      await spidyyApi.completeDeployment(depId);
      setZipUploadProgress(100);
      setZipUploadStatusText('Deployment successful! Live on edge.');
      setTimeout(() => {
        setShowZipUploadModal(false);
        setZipFile(null);
        setZipReport(null);
        setZipUploading(false);
        openProject(selectedProjectId);
      }, 800);
    } catch (err: any) {
      setZipUploading(false);
      setZipUploadStatusText(`Error: ${err.message || 'Upload failed'}`);
    }
  }

  async function handleRollback(deploymentId: string) {
    try {
      await spidyyApi.rollbackDeployment(deploymentId);
      if (selectedProjectId) openProject(selectedProjectId);
      loadDashboardData();
    } catch (err: any) {
      alert(err.message || 'Rollback failed');
    }
  }

  async function handleRedeploy(deploymentId: string) {
    try {
      await spidyyApi.redeployDeployment(deploymentId);
      if (selectedProjectId) openProject(selectedProjectId);
      loadDashboardData();
    } catch (err: any) {
      alert(err.message || 'Redeploy failed');
    }
  }

  async function handleDeleteDeployment(deploymentId: string) {
    if (!confirm('Are you sure you want to delete this deployment?')) return;
    try {
      await spidyyApi.deleteDeployment(deploymentId);
      if (selectedProjectId) openProject(selectedProjectId);
      loadDashboardData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete deployment');
    }
  }

  async function handleCreateToken() {
    if (!selectedProjectId) return;
    try {
      const res = await spidyyApi.createProjectToken(selectedProjectId, 'GitHub Actions CI');
      setNewlyGeneratedToken(res.token);
      const tokRes = await spidyyApi.listProjectTokens(selectedProjectId);
      setGithubTokens(tokRes.tokens);
    } catch (err: any) {
      alert(err.message || 'Failed to generate token');
    }
  }

  async function handleRevokeToken(tokenId: string) {
    if (!selectedProjectId) return;
    try {
      await spidyyApi.revokeProjectToken(selectedProjectId, tokenId);
      const tokRes = await spidyyApi.listProjectTokens(selectedProjectId);
      setGithubTokens(tokRes.tokens);
    } catch (err: any) {
      alert(err.message || 'Failed to revoke token');
    }
  }

  async function handleAddDomain(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProjectId || !newDomainHost) return;
    try {
      await spidyyApi.addProjectDomain(selectedProjectId, newDomainHost);
      setNewDomainHost('');
      setShowDomainModal(false);
      const domRes = await spidyyApi.listProjectDomains(selectedProjectId);
      setDomains(domRes.domains);
    } catch (err: any) {
      alert(err.message || 'Failed to add domain');
    }
  }

  async function handleDeleteDomain(domainId: string) {
    if (!selectedProjectId) return;
    if (!confirm('Remove this custom domain?')) return;
    try {
      await spidyyApi.deleteProjectDomain(selectedProjectId, domainId);
      const domRes = await spidyyApi.listProjectDomains(selectedProjectId);
      setDomains(domRes.domains);
    } catch (err: any) {
      alert(err.message || 'Failed to remove domain');
    }
  }

  async function handleAddEnv(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProjectId || !newEnvKey || !newEnvVal) return;
    try {
      await spidyyApi.upsertProjectEnvVar(selectedProjectId, {
        keyName: newEnvKey.toUpperCase(),
        value: newEnvVal,
        target: newEnvTarget,
      });
      setNewEnvKey('');
      setNewEnvVal('');
      setShowEnvModal(false);
      const envRes = await spidyyApi.listProjectEnvVars(selectedProjectId);
      setEnvVars(envRes.envVars);
    } catch (err: any) {
      alert(err.message || 'Failed to save environment variable');
    }
  }

  async function handleDeleteEnv(envId: string) {
    if (!selectedProjectId) return;
    try {
      await spidyyApi.deleteProjectEnvVar(selectedProjectId, envId);
      const envRes = await spidyyApi.listProjectEnvVars(selectedProjectId);
      setEnvVars(envRes.envVars);
    } catch (err: any) {
      alert(err.message || 'Failed to delete env var');
    }
  }

  if (loadingUser) {
    return (
      <div className="min-h-screen bg-[#0A0C10] flex items-center justify-center text-slate-400">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
          <span className="text-sm font-medium tracking-wide">Initializing SPIDYY CLOUD...</span>
        </div>
      </div>
    );
  }

  // 1. Landing Page View
  if (!user || activeTab === 'landing') {
    return (
      <div className="min-h-screen bg-[#0A0C10] text-slate-100 selection:bg-blue-600 selection:text-white font-sans">
        {/* Top Navigation Bar */}
        <header className="sticky top-0 z-50 flex items-center justify-between gap-8 px-6 lg:px-12 py-4 border-b border-slate-800/80 bg-[#0A0C10]/90 backdrop-blur-md">
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-600/20">
              <Cloud className="w-5 h-5" />
            </div>
            <span className="text-lg font-bold tracking-tight text-white font-display">
              SPIDYY CLOUD
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <a href="#features" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Platform
            </a>
            <a href="#architecture" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Edge Infrastructure
            </a>
            <a href="#github" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              GitHub Actions
            </a>
            <a href="#pricing" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Free-Tier Guarantee
            </a>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            {user ? (
              <button
                onClick={() => setActiveTab('dashboard')}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 shadow-sm"
              >
                Open Dashboard
              </button>
            ) : (
              <>
                <button
                  onClick={() => {
                    setAuthMode('login');
                    setActiveTab('dashboard');
                  }}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
                >
                  Sign In
                </button>
                <button
                  onClick={() => {
                    setAuthMode('register');
                    setActiveTab('dashboard');
                  }}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 shadow-sm"
                >
                  Start Deploying
                </button>
              </>
            )}
          </div>
        </header>

        {/* Hero Section */}
        <section className="relative px-6 lg:px-12 pt-20 pb-28 max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400 text-xs font-medium">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Zero-Budget Edge Hosting & Deployment Platform</span>
              </div>
              <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-white font-display leading-[1.1]">
                From Code to Cloud. <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-300 to-slate-200">
                  Deploy Without Limits.
                </span>
              </h1>
              <p className="text-lg text-slate-400 max-w-xl leading-relaxed font-normal">
                Independent developer hosting platform powered by Cloudflare Workers, D1, R2, and GitHub Actions. Drag-and-drop static ZIP releases or push to GitHub for instant edge availability.
              </p>
              <div className="flex flex-wrap items-center gap-4 pt-2">
                <button
                  onClick={() => {
                    setAuthMode('register');
                    setActiveTab('dashboard');
                  }}
                  className="px-6 py-3 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/25 flex items-center gap-2 group"
                >
                  <span>Deploy Your First Site</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </button>
                <button
                  onClick={() => setActiveTab('docs')}
                  className="px-6 py-3 text-sm font-medium text-slate-300 border border-slate-800 bg-slate-900/60 rounded-xl hover:bg-slate-800 transition-colors flex items-center gap-2"
                >
                  <BookOpen className="w-4 h-4 text-slate-400" />
                  <span>Read Documentation</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-6 pt-8 border-t border-slate-800/80">
                <div>
                  <div className="text-2xl font-bold text-white font-mono tabular-nums">0 ms</div>
                  <div className="text-xs text-slate-400 mt-0.5">Cold start latency</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-white font-mono tabular-nums">100%</div>
                  <div className="text-xs text-slate-400 mt-0.5">Static edge cache</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-white font-mono tabular-nums">₹0</div>
                  <div className="text-xs text-slate-400 mt-0.5">Always free tier</div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="relative rounded-2xl border border-slate-800 bg-slate-900/80 p-2 shadow-2xl overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-tr from-blue-600/10 via-transparent to-indigo-600/10 pointer-events-none" />
                <img
                  src="/src/assets/images/hero_edge_infrastructure_1795236083834.jpg"
                  alt="SPIDYY CLOUD Edge Infrastructure"
                  className="w-full h-[360px] object-cover rounded-xl"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute bottom-4 left-4 right-4 bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-white">production-release-v2.zip</div>
                      <div className="text-[11px] text-slate-400">Deployed live via R2 Edge Engine</div>
                    </div>
                  </div>
                  <span className="text-xs font-mono text-blue-400 bg-blue-500/10 border border-blue-500/30 px-2 py-1 rounded">
                    ACTIVE
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Architecture & Features Grid */}
        <section id="features" className="px-6 lg:px-12 py-24 border-t border-slate-800/80 bg-slate-950/50">
          <div className="max-w-7xl mx-auto">
            <div className="max-w-2xl mb-16">
              <h2 className="text-xs font-mono uppercase tracking-widest text-blue-400 mb-3">
                Built for Speed & Reliability
              </h2>
              <h3 className="text-3xl sm:text-4xl font-bold tracking-tight text-white font-display">
                Everything you need to ship static web apps with confidence.
              </h3>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              <div className="border border-slate-800 bg-slate-900/40 p-8 rounded-2xl hover:border-slate-700 transition-colors">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 mb-6">
                  <FileArchive className="w-6 h-6" />
                </div>
                <h4 className="text-lg font-semibold text-white mb-2">Real ZIP Deployments</h4>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Extract ZIP archives right in your browser, validate file structures instantly, and upload directly to Cloudflare R2 through our authenticated backend API.
                </p>
              </div>

              <div className="border border-slate-800 bg-slate-900/40 p-8 rounded-2xl hover:border-slate-700 transition-colors">
                <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-6">
                  <Github className="w-6 h-6" />
                </div>
                <h4 className="text-lg font-semibold text-white mb-2">GitHub Actions CI/CD</h4>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Generate project-specific deployment tokens and ready-to-copy GitHub Actions workflows to automate builds for React, Vite, Vue, and Astro.
                </p>
              </div>

              <div className="border border-slate-800 bg-slate-900/40 p-8 rounded-2xl hover:border-slate-700 transition-colors">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-6">
                  <Shield className="w-6 h-6" />
                </div>
                <h4 className="text-lg font-semibold text-white mb-2">Secure Tenant Isolation</h4>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Multi-tenant static hosting engine with path traversal defense, strict content type mapping, SPA fallback routes, and rollback capabilities.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="px-6 lg:px-12 py-12 border-t border-slate-800/80 bg-[#0A0C10] text-sm text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-4 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center text-white">
              <Cloud className="w-3.5 h-3.5" />
            </div>
            <span className="font-semibold text-white">SPIDYY CLOUD</span>
            <span className="text-slate-600">·</span>
            <span>From Code to Cloud. Deploy Without Limits.</span>
          </div>
          <div className="flex items-center gap-6">
            <button onClick={() => setActiveTab('docs')} className="hover:text-white transition-colors">
              Documentation
            </button>
            <button onClick={() => setActiveTab('dashboard')} className="hover:text-white transition-colors">
              Dashboard
            </button>
          </div>
        </footer>
      </div>
    );
  }

  // 2. Auth / Sign In / Register View
  if (!user) {
    return (
      <div className="min-h-screen bg-[#0A0C10] text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full border border-slate-800 bg-slate-900/80 p-8 rounded-2xl shadow-2xl relative">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-600/30">
                <Cloud className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white font-display">SPIDYY CLOUD</h1>
                <p className="text-xs text-slate-400">Developer Hosting Platform</p>
              </div>
            </div>
            <button
              onClick={() => setActiveTab('landing')}
              className="text-xs text-slate-400 hover:text-white transition-colors"
            >
              Back to Home
            </button>
          </div>

          <div className="flex items-center gap-2 p-1 bg-slate-950 rounded-xl mb-6 border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setAuthMode('login');
                setAuthError(null);
              }}
              className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                authMode === 'login' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('register');
                setAuthError(null);
              }}
              className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                authMode === 'register' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>

          {authError && (
            <div className="mb-6 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {authMode === 'register' && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Developer Name</label>
                <input
                  type="text"
                  required
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  placeholder="Alex Developer"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
              <input
                type="email"
                required
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="developer@example.com"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
              />
              <p className="text-[11px] text-slate-400 mt-1">Minimum 8 characters with PBKDF2 hashing.</p>
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition-colors shadow-lg shadow-blue-600/25 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {authLoading && <RefreshCw className="w-4 h-4 animate-spin" />}
              <span>{authMode === 'login' ? 'Sign In to Dashboard' : 'Create Free Account'}</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Main Dashboard Shell (Authenticated)
  return (
    <div className="min-h-screen bg-[#0A0C10] text-slate-100 flex font-sans selection:bg-blue-600 selection:text-white">
      {/* Sidebar Navigation */}
      <aside className="hidden lg:flex flex-col w-64 border-r border-slate-800 bg-[#0C0F14] shrink-0">
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow">
              <Cloud className="w-4 h-4" />
            </div>
            <div>
              <span className="text-sm font-bold tracking-tight text-white font-display">SPIDYY CLOUD</span>
              <div className="text-[10px] text-slate-400">Edge Tier</div>
            </div>
          </div>
        </div>

        <div className="p-4 flex-1 space-y-1">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-colors ${
              activeTab === 'dashboard' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Dashboard</span>
          </button>
          <button
            onClick={() => setActiveTab('projects')}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-colors ${
              activeTab === 'projects' || activeTab === 'project-detail'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Server className="w-4 h-4" />
            <span>Projects</span>
          </button>
          <button
            onClick={() => setActiveTab('deployments')}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-colors ${
              activeTab === 'deployments' || activeTab === 'deployment-detail'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Deployments</span>
          </button>
          <button
            onClick={() => setActiveTab('domains')}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-colors ${
              activeTab === 'domains' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Globe className="w-4 h-4" />
            <span>Domains & SSL</span>
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-colors ${
              activeTab === 'analytics' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Usage & Quotas</span>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-colors ${
              activeTab === 'settings' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Account Settings</span>
          </button>
          <button
            onClick={() => setActiveTab('docs')}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-colors ${
              activeTab === 'docs' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Documentation</span>
          </button>
        </div>

        <div className="p-4 border-t border-slate-800">
          <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 mb-3">
            <div className="text-xs font-medium text-white truncate">{user.name}</div>
            <div className="text-[11px] text-slate-400 truncate">{user.email}</div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-16 border-b border-slate-800 bg-[#0A0C10]/90 backdrop-blur-md px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">SPIDYY CLOUD</span>
              <span className="text-slate-700">/</span>
              <span className="font-semibold text-white capitalize">{activeTab.replace('-', ' ')}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setNewProjName('');
                setNewProjSlug('');
                setShowNewProjectModal(true);
              }}
              className="px-3.5 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors shadow-sm flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>New Project</span>
            </button>
          </div>
        </header>

        {/* Dynamic Viewport Content */}
        <div className="flex-1 p-6 lg:p-10 overflow-y-auto">
          {/* Dashboard Overview */}
          {activeTab === 'dashboard' && (
            <div className="max-w-6xl mx-auto space-y-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-white font-display">Welcome back, {user.name}</h1>
                  <p className="text-sm text-slate-400">Manage your edge projects, ZIP releases, and deployments.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setActiveTab('projects')}
                    className="px-4 py-2 text-xs font-medium text-slate-300 border border-slate-800 bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors"
                  >
                    View All Projects ({projects.length})
                  </button>
                </div>
              </div>

              {/* Stats Cards Grid */}
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="border border-slate-800 bg-slate-900/40 p-5 rounded-2xl">
                  <div className="flex items-center justify-between text-slate-400 mb-3">
                    <span className="text-xs font-medium">Total Projects</span>
                    <Server className="w-4 h-4 text-blue-400" />
                  </div>
                  <div className="text-2xl font-bold text-white font-mono tabular-nums">
                    {projects.length} <span className="text-xs font-normal text-slate-400">/ {SPIDYY_LIMITS.MAX_PROJECTS_PER_USER}</span>
                  </div>
                  <div className="text-[11px] text-emerald-400 mt-2 flex items-center gap-1">
                    <span>Active edge slots</span>
                  </div>
                </div>

                <div className="border border-slate-800 bg-slate-900/40 p-5 rounded-2xl">
                  <div className="flex items-center justify-between text-slate-400 mb-3">
                    <span className="text-xs font-medium">Successful Deployments</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="text-2xl font-bold text-white font-mono tabular-nums">
                    {accountUsage?.current.successfulDeployments ?? 0}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-2">Verified R2 static releases</div>
                </div>

                <div className="border border-slate-800 bg-slate-900/40 p-5 rounded-2xl">
                  <div className="flex items-center justify-between text-slate-400 mb-3">
                    <span className="text-xs font-medium">Storage Utilized</span>
                    <HardDrive className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div className="text-2xl font-bold text-white font-mono tabular-nums">
                    {Math.round(((accountUsage?.current.storedBytes ?? 0) / (1024 * 1024)) * 10) / 10} MB
                  </div>
                  <div className="text-[11px] text-slate-400 mt-2">Limit: 250 MB free tier</div>
                </div>

                <div className="border border-slate-800 bg-slate-900/40 p-5 rounded-2xl">
                  <div className="flex items-center justify-between text-slate-400 mb-3">
                    <span className="text-xs font-medium">Edge Site Requests</span>
                    <Activity className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="text-2xl font-bold text-white font-mono tabular-nums">
                    {accountUsage?.current.siteRequests ?? 0}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-2">Served via Workers</div>
                </div>
              </div>

              {/* Recent Projects Table & Activity */}
              <div className="grid lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 border border-slate-800 bg-slate-900/40 rounded-2xl p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-base font-bold text-white font-display">Active Projects</h2>
                    <button
                      onClick={() => setActiveTab('projects')}
                      className="text-xs text-blue-400 hover:text-blue-300 font-medium"
                    >
                      View All
                    </button>
                  </div>

                  {projects.length === 0 ? (
                    <div className="text-center py-12 border border-dashed border-slate-800 rounded-xl">
                      <Server className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                      <p className="text-sm font-medium text-white mb-1">No projects created yet</p>
                      <p className="text-xs text-slate-400 mb-4">Deploy your first static website ZIP or GitHub repository.</p>
                      <button
                        onClick={() => setShowNewProjectModal(true)}
                        className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors"
                      >
                        Create Project
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {projects.slice(0, 5).map((p) => (
                        <div
                          key={p.id}
                          onClick={() => openProject(p.id)}
                          className="flex items-center justify-between p-4 rounded-xl border border-slate-800/80 bg-slate-950/50 hover:border-slate-700 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
                              <Server className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-white">{p.name}</div>
                              <div className="text-xs text-slate-400 font-mono">/s/{p.slug}/</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-full">
                              {p.status}
                            </span>
                            <ChevronRight className="w-4 h-4 text-slate-600" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Activity & Quick Launch */}
                <div className="space-y-6">
                  <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-6">
                    <h2 className="text-base font-bold text-white font-display mb-4">Quick Deploy</h2>
                    <p className="text-xs text-slate-400 mb-6 leading-relaxed">
                      Upload a ready-to-serve static website ZIP archive or connect your GitHub repository for automated CI/CD builds.
                    </p>
                    <div className="space-y-3">
                      <button
                        onClick={() => {
                          if (projects.length === 0) {
                            setShowNewProjectModal(true);
                          } else {
                            setSelectedProjectId(projects[0].id);
                            setShowZipUploadModal(true);
                          }
                        }}
                        className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors flex items-center justify-center gap-2 shadow-sm"
                      >
                        <UploadCloud className="w-4 h-4" />
                        <span>Upload Static ZIP Release</span>
                      </button>
                      <button
                        onClick={() => setActiveTab('docs')}
                        className="w-full py-3 px-4 rounded-xl border border-slate-800 bg-slate-950 hover:bg-slate-800 text-slate-300 font-medium text-xs transition-colors flex items-center justify-center gap-2"
                      >
                        <BookOpen className="w-4 h-4 text-slate-400" />
                        <span>View GitHub Actions Guide</span>
                      </button>
                    </div>
                  </div>

                  {accountUsage && accountUsage.warnings.length > 0 && (
                    <div className="border border-amber-500/30 bg-amber-500/10 rounded-2xl p-5 text-amber-300 text-xs space-y-2">
                      <div className="font-semibold flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>Usage Warning</span>
                      </div>
                      <ul className="list-disc list-inside space-y-1 text-amber-200/90">
                        {accountUsage.warnings.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Projects View */}
          {activeTab === 'projects' && (
            <div className="max-w-6xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-white font-display">Projects</h1>
                  <p className="text-sm text-slate-400">All static web hosting projects on SPIDYY CLOUD.</p>
                </div>
                <button
                  onClick={() => setShowNewProjectModal(true)}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors shadow-sm flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>New Project</span>
                </button>
              </div>

              {projects.length === 0 ? (
                <div className="text-center py-16 border border-dashed border-slate-800 rounded-2xl bg-slate-900/20">
                  <Server className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <p className="text-base font-medium text-white mb-1">No projects found</p>
                  <p className="text-sm text-slate-400 mb-6">Create your first static site project to get started.</p>
                  <button
                    onClick={() => setShowNewProjectModal(true)}
                    className="px-4 py-2.5 text-xs font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-500 transition-colors"
                  >
                    Create Project
                  </button>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {projects.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => openProject(p.id)}
                      className="border border-slate-800 bg-slate-900/40 p-6 rounded-2xl hover:border-slate-700 transition-colors cursor-pointer flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
                            <Server className="w-5 h-5" />
                          </div>
                          <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-full">
                            {p.status}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-white mb-1">{p.name}</h3>
                        <p className="text-xs text-slate-400 font-mono mb-4">/s/{p.slug}/</p>
                      </div>

                      <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                        <span>Framework: <strong className="text-slate-200">{p.framework}</strong></span>
                        <a
                          href={p.liveUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
                        >
                          <span>Visit Live</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Project Detail View */}
          {activeTab === 'project-detail' && selectedProjectId && (() => {
            const proj = projects.find((p) => p.id === selectedProjectId);
            if (!proj) return <div>Project not found</div>;
            return (
              <div className="max-w-6xl mx-auto space-y-8">
                {/* Project Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h1 className="text-2xl font-bold text-white font-display">{proj.name}</h1>
                      <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-full">
                        {proj.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 font-mono">Slug: /s/{proj.slug}/ · Framework: {proj.framework}</div>
                  </div>

                  <div className="flex items-center gap-3">
                    <a
                      href={proj.liveUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors flex items-center gap-2 shadow-sm"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span>Open Live Site</span>
                    </a>
                    <button
                      onClick={() => setShowZipUploadModal(true)}
                      className="px-4 py-2 text-xs font-medium text-slate-300 border border-slate-800 bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-2"
                    >
                      <UploadCloud className="w-4 h-4 text-blue-400" />
                      <span>Upload ZIP</span>
                    </button>
                    <button
                      onClick={async () => {
                        if (confirm('Delete this project and all its deployments?')) {
                          await spidyyApi.deleteProject(proj.id);
                          loadDashboardData();
                          setActiveTab('projects');
                        }
                      }}
                      className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      title="Delete Project"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Project Sub-sections */}
                <div className="grid lg:grid-cols-3 gap-8">
                  {/* Deployments List (2 Cols) */}
                  <div className="lg:col-span-2 space-y-6">
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-bold text-white font-display">Deployment History</h2>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleDownloadSampleZip}
                          className="px-3 py-1.5 text-xs font-medium text-slate-300 border border-slate-800 bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5"
                        >
                          <FileArchive className="w-3.5 h-3.5 text-blue-400" />
                          <span>Download Sample ZIP</span>
                        </button>
                        <button
                          onClick={() => setShowZipUploadModal(true)}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors flex items-center gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>New Deployment</span>
                        </button>
                      </div>
                    </div>

                    {deployments.length === 0 ? (
                      <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl bg-slate-900/20">
                        <Layers className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                        <p className="text-sm font-medium text-white mb-1">No deployments yet</p>
                        <p className="text-xs text-slate-400 mb-4">Upload a static website ZIP archive to deploy.</p>
                        <button
                          onClick={() => setShowZipUploadModal(true)}
                          className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors"
                        >
                          Upload ZIP Release
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {deployments.map((d) => (
                          <div
                            key={d.id}
                            onClick={() => openDeployment(d.id)}
                            className="flex items-center justify-between p-4 rounded-xl border border-slate-800 bg-slate-900/40 hover:border-slate-700 transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                                  d.status === 'ready'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                    : d.status === 'failed'
                                      ? 'bg-red-500/10 text-red-400 border border-red-500/30'
                                      : 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                                }`}
                              >
                                {d.status === 'ready' ? (
                                  <CheckCircle2 className="w-4 h-4" />
                                ) : d.status === 'failed' ? (
                                  <AlertCircle className="w-4 h-4" />
                                ) : (
                                  <Clock className="w-4 h-4 animate-spin" />
                                )}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold text-white font-mono">{d.id.slice(0, 12)}...</span>
                                  {d.isProduction && (
                                    <span className="text-[10px] font-mono bg-blue-500/20 border border-blue-500/40 text-blue-400 px-2 py-0.5 rounded">
                                      PRODUCTION
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-400 flex items-center gap-3 mt-0.5">
                                  <span>Source: {d.source}</span>
                                  <span>·</span>
                                  <span>{d.fileCount} files ({Math.round(d.totalBytes / 1024)} KB)</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <span className="text-xs font-mono uppercase text-slate-400">{d.status}</span>
                              <ChevronRight className="w-4 h-4 text-slate-600" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* GitHub Actions & Tokens Sidebar */}
                  <div className="space-y-6">
                    <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-bold text-white font-display flex items-center gap-2">
                          <Github className="w-4 h-4 text-indigo-400" />
                          <span>GitHub CI/CD</span>
                        </h3>
                        <button
                          onClick={() => setShowGithubModal(true)}
                          className="text-xs text-blue-400 hover:text-blue-300 font-medium"
                        >
                          View Workflow
                        </button>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Automate deployments on every push to <strong className="text-white">{proj.repoBranch}</strong> using GitHub Actions.
                      </p>

                      {githubTokens.length === 0 ? (
                        <button
                          onClick={handleCreateToken}
                          className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition-colors shadow-sm flex items-center justify-center gap-2"
                        >
                          <Key className="w-4 h-4" />
                          <span>Generate Deploy Token</span>
                        </button>
                      ) : (
                        <div className="space-y-3">
                          {githubTokens.map((t) => (
                            <div key={t.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-white">{t.name}</span>
                                <button
                                  onClick={() => handleRevokeToken(t.id)}
                                  className="text-red-400 hover:text-red-300"
                                >
                                  Revoke
                                </button>
                              </div>
                              <div className="text-[11px] font-mono text-slate-400 bg-slate-900 p-1.5 rounded border border-slate-800">
                                {t.tokenPrefix}
                              </div>
                            </div>
                          ))}
                          <button
                            onClick={handleCreateToken}
                            className="w-full py-2 text-xs font-medium text-slate-300 border border-slate-800 bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
                          >
                            Generate New Token
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Domains Quick Summary */}
                    <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-bold text-white font-display flex items-center gap-2">
                          <Globe className="w-4 h-4 text-emerald-400" />
                          <span>Domains</span>
                        </h3>
                        <button
                          onClick={() => setShowDomainModal(true)}
                          className="text-xs text-blue-400 hover:text-blue-300 font-medium"
                        >
                          Add Custom
                        </button>
                      </div>
                      <div className="space-y-2">
                        {domains.map((dom) => (
                          <div key={dom.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs flex items-center justify-between">
                            <span className="font-mono text-white truncate">{dom.hostname}</span>
                            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                              {dom.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Deployment Detail View */}
          {activeTab === 'deployment-detail' && selectedDeploymentData && (() => {
            const dep = selectedDeploymentData.deployment;
            return (
              <div className="max-w-5xl mx-auto space-y-8">
                <div className="flex items-center justify-between border-b border-slate-800 pb-6">
                  <div>
                    <button
                      onClick={() => {
                        if (selectedProjectId) openProject(selectedProjectId);
                        else setActiveTab('deployments');
                      }}
                      className="text-xs text-blue-400 hover:text-blue-300 mb-2 flex items-center gap-1"
                    >
                      ← Back to Project
                    </button>
                    <div className="flex items-center gap-3">
                      <h1 className="text-2xl font-bold text-white font-display font-mono">Deployment {dep.id}</h1>
                      <span
                        className={`text-xs font-mono uppercase px-2.5 py-1 rounded-full ${
                          dep.status === 'ready'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                            : 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                        }`}
                      >
                        {dep.status}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {dep.status === 'ready' && !dep.isProduction && (
                      <button
                        onClick={() => handleRollback(dep.id)}
                        className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-4 h-4" />
                        <span>Promote to Production</span>
                      </button>
                    )}
                    <button
                      onClick={() => handleRedeploy(dep.id)}
                      className="px-4 py-2 text-xs font-medium text-slate-300 border border-slate-800 bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>Redeploy</span>
                    </button>
                    {!dep.isProduction && (
                      <button
                        onClick={() => handleDeleteDeployment(dep.id)}
                        className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Deployment Metadata & Logs */}
                <div className="grid md:grid-cols-2 gap-8">
                  <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-6 space-y-4">
                    <h2 className="text-base font-bold text-white font-display">Deployment Metrics</h2>
                    <div className="space-y-3 text-xs">
                      <div className="flex justify-between py-2 border-b border-slate-800/80">
                        <span className="text-slate-400">Source</span>
                        <span className="font-semibold text-white uppercase">{dep.source}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-slate-800/80">
                        <span className="text-slate-400">Files Stored</span>
                        <span className="font-mono text-white">{dep.fileCount} files</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-slate-800/80">
                        <span className="text-slate-400">Total Size</span>
                        <span className="font-mono text-white">{Math.round(dep.totalBytes / 1024)} KB</span>
                      </div>
                      <div className="flex justify-between py-2 border-b border-slate-800/80">
                        <span className="text-slate-400">Duration</span>
                        <span className="font-mono text-white">{dep.durationMs} ms</span>
                      </div>
                      <div className="flex justify-between py-2">
                        <span className="text-slate-400">Live URL</span>
                        <a href={dep.liveUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline truncate max-w-[240px]">
                          {dep.liveUrl}
                        </a>
                      </div>
                    </div>
                  </div>

                  <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-6 space-y-4">
                    <h2 className="text-base font-bold text-white font-display flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-blue-400" />
                      <span>Execution Logs</span>
                    </h2>
                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs space-y-2 h-[240px] overflow-y-auto">
                      {dep.logs.map((log, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <span className="text-slate-600 shrink-0">[{log.timestamp.slice(11, 19)}]</span>
                          <span
                            className={
                              log.level === 'error'
                                ? 'text-red-400'
                                : log.level === 'success'
                                  ? 'text-emerald-400'
                                  : 'text-slate-300'
                            }
                          >
                            {log.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Domains Management View */}
          {activeTab === 'domains' && (
            <div className="max-w-5xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-white font-display">Domains & SSL</h1>
                  <p className="text-sm text-slate-400">Manage custom domains and platform workers.dev hosting URLs.</p>
                </div>
              </div>

              <div className="border border-slate-800 bg-slate-900/40 rounded-2xl overflow-hidden">
                <div className="p-6 border-b border-slate-800 flex items-center justify-between">
                  <h2 className="text-base font-bold text-white font-display">Registered Domains</h2>
                </div>
                <div className="divide-y divide-slate-800/80">
                  {domains.map((dom) => (
                    <div key={dom.id} className="p-5 flex items-center justify-between hover:bg-slate-900/60 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                          <Globe className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-white font-mono">{dom.hostname}</div>
                          <div className="text-xs text-slate-400">Type: {dom.type} · Project ID: {dom.projectId.slice(0, 10)}...</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-xs font-mono uppercase px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                          {dom.status}
                        </span>
                        {dom.type === 'custom' && (
                          <button
                            onClick={() => handleDeleteDomain(dom.id)}
                            className="text-slate-400 hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Usage & Analytics View */}
          {activeTab === 'analytics' && accountUsage && (
            <div className="max-w-6xl mx-auto space-y-8">
              <div>
                <h1 className="text-2xl font-bold text-white font-display">Usage & Quotas</h1>
                <p className="text-sm text-slate-400">Monitor your free-tier resource consumption and account limits.</p>
              </div>

              <div className="grid sm:grid-cols-3 gap-6">
                <div className="border border-slate-800 bg-slate-900/40 p-6 rounded-2xl">
                  <div className="text-xs font-medium text-slate-400 mb-2">Projects Created</div>
                  <div className="text-3xl font-bold text-white font-mono tabular-nums">
                    {accountUsage.current.projectCount} <span className="text-sm text-slate-400">/ {accountUsage.limits.maxProjectsPerUser}</span>
                  </div>
                </div>

                <div className="border border-slate-800 bg-slate-900/40 p-6 rounded-2xl">
                  <div className="text-xs font-medium text-slate-400 mb-2">Account Storage</div>
                  <div className="text-3xl font-bold text-white font-mono tabular-nums">
                    {Math.round((accountUsage.current.storedBytes / (1024 * 1024)) * 10) / 10} MB
                    <span className="text-sm text-slate-400"> / 250 MB</span>
                  </div>
                </div>

                <div className="border border-slate-800 bg-slate-900/40 p-6 rounded-2xl">
                  <div className="text-xs font-medium text-slate-400 mb-2">Edge Requests</div>
                  <div className="text-3xl font-bold text-white font-mono tabular-nums">
                    {accountUsage.current.siteRequests}
                  </div>
                </div>
              </div>

              {/* Activity Chart */}
              <div className="border border-slate-800 bg-slate-900/40 p-6 rounded-2xl space-y-6">
                <h2 className="text-base font-bold text-white font-display">14-Day Deployment & Request Activity</h2>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={accountUsage.dailyActivity}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
                      <XAxis dataKey="date" stroke="#9CA3AF" fontSize={11} />
                      <YAxis stroke="#9CA3AF" fontSize={11} />
                      <Tooltip
                        contentStyle={{ background: '#0F172A', borderColor: '#334155', borderRadius: '8px' }}
                        labelStyle={{ color: '#F8FAFC' }}
                      />
                      <Area type="monotone" dataKey="siteRequests" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.15} name="Site Requests" />
                      <Area type="monotone" dataKey="deployments" stroke="#10B981" fill="#10B981" fillOpacity={0.15} name="Deployments" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* Account Settings View */}
          {activeTab === 'settings' && (
            <div className="max-w-3xl mx-auto space-y-8">
              <div>
                <h1 className="text-2xl font-bold text-white font-display">Account Settings</h1>
                <p className="text-sm text-slate-400">Update your developer profile and password credentials.</p>
              </div>

              {settingMessage && (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs">
                  {settingMessage}
                </div>
              )}

              <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-8 space-y-6">
                <h2 className="text-lg font-bold text-white font-display">Developer Profile</h2>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      const res = await spidyyApi.updateProfile({ name: settingName });
                      setUser(res.user);
                      setSettingMessage('Profile updated successfully.');
                    } catch (err: any) {
                      alert(err.message || 'Failed to update profile');
                    }
                  }}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Display Name</label>
                    <input
                      type="text"
                      value={settingName}
                      onChange={(e) => setSettingName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Email Address (Read-only)</label>
                    <input
                      type="email"
                      disabled
                      value={user.email}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/50 border border-slate-800 text-sm text-slate-500 cursor-not-allowed"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors shadow-sm"
                  >
                    Save Changes
                  </button>
                </form>
              </div>

              {/* Password Change */}
              <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-8 space-y-6">
                <h2 className="text-lg font-bold text-white font-display">Change Password</h2>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await spidyyApi.changePassword({ currentPassword, newPassword });
                      setCurrentPassword('');
                      setNewPassword('');
                      setSettingMessage('Password changed successfully.');
                    } catch (err: any) {
                      alert(err.message || 'Failed to change password');
                    }
                  }}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Current Password</label>
                    <input
                      type="password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">New Password</label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors shadow-sm"
                  >
                    Update Password
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Documentation View */}
          {activeTab === 'docs' && (
            <div className="max-w-4xl mx-auto space-y-8">
              <div>
                <h1 className="text-3xl font-bold text-white font-display">Documentation</h1>
                <p className="text-base text-slate-400">Complete developer guide for SPIDYY CLOUD hosting & deployments.</p>
              </div>

              <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-8 space-y-6">
                <h2 className="text-xl font-bold text-white font-display">1. ZIP Upload Deployment Workflow</h2>
                <p className="text-sm text-slate-400 leading-relaxed">
                  SPIDYY CLOUD accepts prebuilt static website outputs (HTML, CSS, JS, images, fonts).
                </p>
                <ol className="list-decimal list-inside space-y-2 text-sm text-slate-300">
                  <li>Create a project in your dashboard.</li>
                  <li>Click <strong>Upload ZIP</strong> or download the sample starter ZIP.</li>
                  <li>Your browser extracts and validates the archive (ensuring root <code>index.html</code> exists and preventing path traversal).</li>
                  <li>Files are uploaded individually to Cloudflare R2 and verified in D1.</li>
                  <li>Your live site is instantly available at <code>/s/your-slug/</code>.</li>
                </ol>
              </div>

              <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-8 space-y-6">
                <h2 className="text-xl font-bold text-white font-display">2. GitHub Actions CI/CD Integration</h2>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Automate deployments on every git push:
                </p>
                <ol className="list-decimal list-inside space-y-2 text-sm text-slate-300">
                  <li>Generate a deployment token in your project settings.</li>
                  <li>Add <code>SPIDYY_DEPLOY_TOKEN</code> to your GitHub Repository Secrets.</li>
                  <li>Add the generated workflow YAML to <code>.github/workflows/spidyy-deploy.yml</code>.</li>
                  <li>Push to your main branch to trigger automated builds and edge deployments.</li>
                </ol>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* New Project Modal */}
      {showNewProjectModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full border border-slate-800 bg-slate-900 p-6 rounded-2xl shadow-2xl space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white font-display">Create New Project</h2>
              <button onClick={() => setShowNewProjectModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {newProjError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {newProjError}
              </div>
            )}

            <form onSubmit={handleCreateProject} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Project Name</label>
                <input
                  type="text"
                  required
                  value={newProjName}
                  onChange={(e) => {
                    setNewProjName(e.target.value);
                    setNewProjSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
                  }}
                  placeholder="My Static Website"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">URL Slug</label>
                <input
                  type="text"
                  required
                  value={newProjSlug}
                  onChange={(e) => setNewProjSlug(e.target.value)}
                  placeholder="my-static-website"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Framework Preset</label>
                <select
                  value={newProjFramework}
                  onChange={(e) => setNewProjFramework(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  {SUPPORTED_FRAMEWORKS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowNewProjectModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={newProjCreating}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors shadow-sm flex items-center gap-2"
                >
                  {newProjCreating && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Create Project</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ZIP Upload Modal */}
      {showZipUploadModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-lg w-full border border-slate-800 bg-slate-900 p-6 rounded-2xl shadow-2xl space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white font-display flex items-center gap-2">
                <UploadCloud className="w-5 h-5 text-blue-400" />
                <span>Upload Static Website ZIP</span>
              </h2>
              <button onClick={() => setShowZipUploadModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!zipReport ? (
              <div className="space-y-4">
                <div className="border-2 border-dashed border-slate-800 rounded-2xl p-8 text-center space-y-4 bg-slate-950/50">
                  <FileArchive className="w-10 h-10 text-blue-400 mx-auto" />
                  <div>
                    <p className="text-sm font-medium text-white mb-1">Choose a .zip archive or drop it here</p>
                    <p className="text-xs text-slate-400">Must include root <code>index.html</code> (Max 50MB)</p>
                  </div>
                  <input
                    type="file"
                    accept=".zip"
                    onChange={handleZipFileSelected}
                    className="hidden"
                    id="zip-file-input"
                  />
                  <label
                    htmlFor="zip-file-input"
                    className="inline-block px-4 py-2.5 text-xs font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-500 transition-colors cursor-pointer"
                  >
                    Select ZIP File
                  </label>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div
                  className={`p-4 rounded-xl border text-xs space-y-2 ${
                    zipReport.valid
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-red-500/10 border-red-500/30 text-red-300'
                  }`}
                >
                  <div className="font-semibold flex items-center gap-2">
                    {zipReport.valid ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    <span>{zipReport.valid ? 'ZIP Archive Validated Successfully' : 'Validation Failed'}</span>
                  </div>
                  {zipReport.valid ? (
                    <p>
                      Found {zipReport.files.length} files ({Math.round(zipReport.totalBytes / 1024)} KB) including root index.html. Ready for deployment.
                    </p>
                  ) : (
                    <ul className="list-disc list-inside space-y-1">
                      {zipReport.errors.map((err, idx) => (
                        <li key={idx}>{err}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {zipUploading && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-slate-300 font-mono">
                      <span>{zipUploadStatusText}</span>
                      <span>{zipUploadProgress}%</span>
                    </div>
                    <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                      <div className="bg-blue-600 h-full transition-all duration-300" style={{ width: `${zipUploadProgress}%` }} />
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setZipFile(null);
                      setZipReport(null);
                    }}
                    className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white"
                  >
                    Choose Different ZIP
                  </button>
                  {zipReport.valid && !zipUploading && (
                    <button
                      onClick={executeZipDeployment}
                      className="px-5 py-2.5 text-xs font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-500 transition-colors shadow-sm"
                    >
                      Deploy to Edge
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* GitHub Workflow Modal */}
      {showGithubModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-2xl w-full border border-slate-800 bg-slate-900 p-6 rounded-2xl shadow-2xl space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white font-display flex items-center gap-2">
                <Github className="w-5 h-5 text-indigo-400" />
                <span>GitHub Actions Workflow Template</span>
              </h2>
              <button onClick={() => setShowGithubModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Save this YAML file into your repository at <code>.github/workflows/spidyy-deploy.yml</code> and add your <code>SPIDYY_DEPLOY_TOKEN</code> to repository secrets.
            </p>
            <div className="relative">
              <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto h-[280px]">
                {githubWorkflowYaml}
              </pre>
              <button
                onClick={() => navigator.clipboard.writeText(githubWorkflowYaml)}
                className="absolute top-3 right-3 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium flex items-center gap-1.5 shadow"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy YAML</span>
              </button>
            </div>
            {newlyGeneratedToken && (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
                <div className="text-xs font-semibold text-emerald-400">Newly Generated Deploy Token (Shown Once):</div>
                <div className="p-2.5 rounded bg-slate-950 font-mono text-xs text-white select-all border border-emerald-500/30">
                  {newlyGeneratedToken}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
