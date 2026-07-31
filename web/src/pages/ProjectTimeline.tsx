import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useFeedback } from '../components/ui/FeedbackProvider';
import { StateBadge } from '../components/StateBadge';
import { CheckpointNew } from '../components/checkpoints/CheckpointNew';
import { CheckpointReview } from '../components/checkpoints/CheckpointReview';
import { CheckpointConfirmation } from '../components/checkpoints/CheckpointConfirmation';
import { CheckpointPrinting } from '../components/checkpoints/CheckpointPrinting';
import { CheckpointCollection } from '../components/checkpoints/CheckpointCollection';
import { useProjects } from '../context/ProjectContext';
import { useStaffSession } from '../context/StaffSessionContext';
import { useSettings } from '../context/SettingsContext';
import { supabase } from '../lib/supabaseClient';
import type { Project } from '../types';
import {
  getNextAction,
  getPartCounts,
  getProjectBlockers,
  type WorkspaceTab
} from '../domain/operations';
import type { ProjectWorkspaceNavigationContext } from '../components/Layout';
import { LocalFilesCard } from '../local-files/LocalFilesCard';
import { ProjectCorrespondencePanel } from '../gmail/ProjectCorrespondencePanel';
import {
  ArrowLeft,
  Archive,
  Mail,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react';

export const ProjectTimeline = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { confirm, notify } = useFeedback();
  const { deleteProject, getProject, projectsLoading, projectsLoadError, updateProject, transitionProjectState } = useProjects();
  const { activeStaffName, claimActiveStaffName } = useStaffSession();
  const { settingsLoading, settingsLoadError } = useSettings();
  const { activeWorkspaceTab, selectWorkspaceTab } = useOutletContext<ProjectWorkspaceNavigationContext>();
  const project = getProject(id || '');
  const autoCreateLocalFolder = (location.state as { autoCreateLocalFolderFor?: string } | null)?.autoCreateLocalFolderFor === project?.id;
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [correspondenceOpen, setCorrespondenceOpen] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [archivingProject, setArchivingProject] = useState(false);
  const staffName = activeStaffName || claimActiveStaffName() || 'System';
  const activeTab = project ? activeWorkspaceTab : 'overview';
  const selectTab = (tab: WorkspaceTab) => {
    if (project) selectWorkspaceTab(tab);
  };
  const handleDeleteProject = async () => {
    if (!project || deletingProject) return;

    const shouldDelete = await confirm({
      title: 'Delete project?',
      message: `This will permanently delete ${project.studentName || 'this project'}, all parts, print runs, and issued quote snapshots.`,
      messages: [
        `Project code: ${project.id}`,
        `Parts to remove: ${project.parts.length}`,
        'Stored part thumbnails will also be removed when available.',
        'This action cannot be undone.'
      ],
      tone: 'error',
      confirmLabel: 'Delete project',
      cancelLabel: 'Keep project'
    });

    if (!shouldDelete) return;

    setDeletingProject(true);
    const deleted = await deleteProject(project.id);
    setDeletingProject(false);

    if (deleted) {
      notify({
        title: 'Project deleted',
        message: `Project ${project.id} and its dependencies were removed.`,
        tone: 'success'
      });
      navigate('/', { replace: true });
    } else {
      notify({
        title: 'Delete failed',
        message: `Project ${project.id} could not be deleted. Please try again.`,
        tone: 'error'
      });
    }
  };

  const handleToggleArchive = async () => {
    if (!project || archivingProject) return;

    const isReviving = project.archived || project.state === 'CANCELLED';
    const shouldToggle = await confirm({
      title: isReviving ? 'Revive project?' : 'Cancel / archive project?',
      message: isReviving
        ? `This will bring ${project.studentName || 'this project'} back into the active workspace.`
        : `This will mark ${project.studentName || 'this project'} as cancelled and archived.`,
      messages: isReviving
        ? [
            `Project code: ${project.id}`,
            'The project will return to the active workspace.'
          ]
        : [
            `Project code: ${project.id}`,
            'The project will be hidden from active workflow views.',
            'You can revive it later if needed.'
          ],
      tone: 'warning',
      confirmLabel: isReviving ? 'Revive project' : 'Cancel / archive',
      cancelLabel: 'Keep project'
    });

    if (!shouldToggle) return;

    setArchivingProject(true);
    const result = await transitionProjectState({
      projectId: project.id,
      action: isReviving ? 'REOPEN_REVIEW' : 'CANCEL_PROJECT',
      technicianName: staffName
    });
    setArchivingProject(false);

    if (!result.ok) {
      notify({
        title: isReviving ? 'Revive failed' : 'Archive failed',
        message: result.errors[0] || 'The project could not be updated.',
        tone: 'error'
      });
      return;
    }

    updateProject(project.id, { archived: !isReviving });

    notify({
      title: isReviving ? 'Project revived' : 'Project archived',
      message: isReviving
        ? `Project ${project.id} is back in the active workspace.`
        : `Project ${project.id} was marked cancelled and archived.`,
      tone: 'success'
    });
  };

  if (settingsLoading) {
    return <ProjectTimelineSkeleton />;
  }

  if (settingsLoadError) {
    return (
      <div className="w-full rounded-lg border border-rose-300 bg-rose-100 p-10 text-center shadow-sm">
        <h1 className="text-xl font-black text-rose-950">Settings could not be loaded</h1>
        <p className="mt-2 text-sm font-semibold text-rose-800">{settingsLoadError}</p>
        <Link to="/" className="mt-5 inline-flex">
          <Button variant="outline" className="gap-2 bg-white"><ArrowLeft size={16} /> Back to Main Dashboard</Button>
        </Link>
      </div>
    );
  }

  if (id === 'new') {
    return (
      <div className="w-full">
        <CheckpointNew />
      </div>
    );
  }

  if (!project) {
    if (projectsLoading) {
      return <ProjectTimelineSkeleton />;
    }

    return (
      <div className="forge-panel w-full p-10 text-center">
        <h1 className="text-xl font-black text-slate-950">
          {projectsLoadError ? 'Projects could not be loaded' : 'Project not found'}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {projectsLoadError || 'The project code may have been removed or is not available in this workspace.'}
        </p>
        <Link to="/" className="mt-5 inline-flex">
          <Button variant="outline" className="gap-2"><ArrowLeft size={16} /> Back to Main Dashboard</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="project-detail-shell w-full">
      <aside className="project-summary-rail print:hidden" aria-label="Current project summary">
        <div className="project-summary-main min-w-0">
          <div className="project-summary-static min-w-0">
            <div className="flex items-start gap-3">
              <StateBadge state={project.state} />
              <div className="min-w-0 flex-1">
                <p className="project-summary-label">Next Action</p>
                <p className="project-summary-action">{getNextAction(project)}</p>
              </div>
            </div>

            <div className="project-summary-divider" />

            <div className="space-y-1.5">
              <div className="project-summary-row">
                <p className="project-summary-label">Priority</p>
                <p className="project-summary-priority">#{project.priorityNumber}</p>
              </div>

              <div className="project-summary-row">
                <p className="project-summary-label">Project ID</p>
                <p className="project-summary-value font-mono">{project.id}</p>
              </div>

              <div className="project-summary-row">
                <p className="project-summary-label">Name</p>
                <p className="project-summary-value">{project.studentName || 'Unnamed Project'}</p>
              </div>

              <div className="project-summary-row">
                <p className="project-summary-label">Module Code</p>
                <p className="project-summary-value">{project.course || 'Not set'}</p>
              </div>

            </div>
          </div>

          <div className="project-summary-local-files">
            <LocalFilesCard project={project} autoCreateIfMissing={autoCreateLocalFolder} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center gap-1.5 px-2"
            onClick={() => setTimelineOpen(true)}
          >
            <ShieldCheck size={15} /> Timeline
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center gap-1.5 px-2"
            onClick={() => setCorrespondenceOpen(true)}
          >
            <Mail size={15} /> Messages
          </Button>
        </div>
      </aside>

      <div className="min-w-0 print:block">
        <div className="min-w-0">
          {activeTab === 'overview' && (
            <OverviewTab
              project={project}
              deletingProject={deletingProject}
              archivingProject={archivingProject}
              onDeleteProject={handleDeleteProject}
              onToggleArchive={handleToggleArchive}
            />
          )}
          {activeTab === 'parts' && (
            <CheckpointReview project={project} onAdvanceFromLockedReview={() => selectTab('quote')} />
          )}
          {activeTab === 'quote' && (
            <CheckpointConfirmation project={project} onAdvanceToProduction={() => selectTab('production')} />
          )}
          {activeTab === 'production' && (
            <CheckpointPrinting project={project} onAdvanceToCollection={() => selectTab('collection')} />
          )}
          {activeTab === 'collection' && <CheckpointCollection project={project} />}
        </div>
      </div>

      {timelineOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35 backdrop-blur-[2px] print:hidden" onClick={() => setTimelineOpen(false)}>
          <aside
            className="forge-drawer h-full w-full max-w-xl overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-300 bg-white/95 px-5 py-4 backdrop-blur">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Project History</p>
                <h2 className="text-lg font-black text-slate-950">View Project Timeline</h2>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setTimelineOpen(false)} aria-label="Close timeline">
                <X size={18} />
              </Button>
            </div>
            <div className="p-5">
              <AuditTab projectId={project.id} />
            </div>
          </aside>
        </div>
      )}
      <ProjectCorrespondencePanel
        project={project}
        open={correspondenceOpen}
        onClose={() => setCorrespondenceOpen(false)}
        onProjectSynced={(updates) => updateProject(project.id, updates)}
      />
    </div>
  );
};

const SkeletonBar = ({ className = '' }: { className?: string }) => (
  <div className={`forge-skeleton rounded ${className}`} />
);

const ProjectTimelineSkeleton = () => (
  <div className="project-detail-shell w-full">
    <aside className="project-summary-rail print:hidden">
      <div className="min-w-0">
        <SkeletonBar className="h-6 w-24 rounded-full" />
        <SkeletonBar className="mt-4 h-3 w-20" />
        <SkeletonBar className="mt-2 h-9 w-full" />
        <div className="project-summary-divider" />
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="mb-3">
            <SkeletonBar className="h-3 w-20" />
            <SkeletonBar className="mt-2 h-5 w-full" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <SkeletonBar className="h-4 w-20" />
        <SkeletonBar className="h-9 w-full" />
      </div>
    </aside>

    <div className="min-w-0">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card className="p-5">
            <SkeletonBar className="h-5 w-40" />
            <SkeletonBar className="mt-4 h-10 w-full" />
            <SkeletonBar className="mt-3 h-10 w-full" />
            <SkeletonBar className="mt-3 h-10 w-2/3" />
          </Card>
          <Card className="p-5">
            <SkeletonBar className="h-5 w-36" />
            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="forge-panel-muted p-3">
                  <SkeletonBar className="h-3 w-20" />
                  <SkeletonBar className="mt-3 h-7 w-14" />
                  <SkeletonBar className="mt-2 h-3 w-24" />
                </div>
              ))}
            </div>
          </Card>
        </div>
        <aside className="space-y-5">
          <Card className="p-5">
            <SkeletonBar className="h-3 w-20" />
            <SkeletonBar className="mt-3 h-6 w-48" />
            <SkeletonBar className="mt-4 h-9 w-full" />
            <SkeletonBar className="mt-2 h-9 w-full" />
          </Card>
          <Card className="p-5">
            <SkeletonBar className="h-3 w-28" />
            <SkeletonBar className="mt-3 h-4 w-full" />
            <SkeletonBar className="mt-4 h-9 w-full" />
          </Card>
        </aside>
      </div>
    </div>
  </div>
);

const WorkspaceMetric = ({ label, value, detail }: { label: string; value: string; detail: string }) => (
  <div className="forge-metric p-3">
    <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-600">{label}</p>
    <p className="mt-1 text-xl font-black text-slate-950">{value}</p>
    <p className="mt-1 truncate text-xs font-semibold text-slate-600">{detail}</p>
  </div>
);

const OverviewTab = ({
  project,
  deletingProject,
  archivingProject,
  onDeleteProject,
  onToggleArchive
}: {
  project: Project;
  deletingProject: boolean;
  archivingProject: boolean;
  onDeleteProject: () => Promise<void>;
  onToggleArchive: () => Promise<void>;
}) => {
  const blockers = getProjectBlockers(project);
  const counts = getPartCounts(project);
  const isArchivedOrCancelled = project.archived || project.state === 'CANCELLED';

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <CheckpointNew project={project} />
      </div>

      <aside className="space-y-5">
        <Card className="p-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Progress</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">Parts and production</h2>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
            <WorkspaceMetric label="Verified" value={`${counts.verified}/${counts.total}`} detail="reviewed parts" />
            <WorkspaceMetric label="Ready" value={`${counts.ready}`} detail="print queue" />
            <WorkspaceMetric label="Printing" value={`${counts.printing}`} detail="active now" />
            <WorkspaceMetric label="Collected" value={`${counts.collected}`} detail="handed over" />
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-600">Project blockers</p>
          <p className="mt-1 text-xs font-semibold text-slate-600">
            Issues that currently prevent this project from moving to the next stage.
          </p>
          <div className="mt-3 space-y-2">
            {blockers.length === 0 ? (
          <div className="rounded-md border border-emerald-300 bg-emerald-100 px-3 py-2 text-sm font-bold text-emerald-900">
                Clear
              </div>
            ) : (
              blockers.map((blocker) => (
                <div key={blocker} className="rounded-md border border-rose-300 bg-rose-100 px-3 py-2 text-sm font-bold text-rose-900">
                  {blocker}
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="border-orange-200 bg-orange-50 p-4 print:hidden">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-orange-700">
                {isArchivedOrCancelled ? 'Revive project' : 'Archive project'}
              </p>
              <p className="mt-1 text-sm text-orange-950">
                {isArchivedOrCancelled
                  ? 'Return this project to the active workspace.'
                  : 'Archived projects can be revived later.'}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-auto gap-2 whitespace-nowrap self-start border-orange-300 text-orange-800 hover:bg-orange-100 sm:self-center"
              onClick={() => void onToggleArchive()}
              loading={archivingProject}
              loadingText={isArchivedOrCancelled ? 'Reviving…' : 'Archiving…'}
            >
              <Archive size={16} />
              {isArchivedOrCancelled ? 'Revive project' : 'Archive project'}
            </Button>
          </div>
        </Card>

        <DeleteProjectCard project={project} deleting={deletingProject} onDelete={onDeleteProject} />
      </aside>
    </div>
  );
};

type AuditEvent = {
  id: number;
  created_at: string;
  technician_name: string;
  action_type: string;
  from_project_state?: string | null;
  to_project_state?: string | null;
  from_part_status?: string | null;
  to_part_status?: string | null;
  reason?: string | null;
  override_note?: string | null;
};

const AuditTab = ({ projectId }: { projectId: string }) => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadEvents = async () => {
      setLoading(true);
      setError(null);
      const { data, error: auditError } = await supabase
        .from('audit_events')
        .select('id,created_at,technician_name,action_type,from_project_state,to_project_state,from_part_status,to_part_status,reason,override_note')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!mounted) return;
      if (auditError) {
        setError(auditError.message);
        setEvents([]);
      } else {
        setEvents((data || []) as AuditEvent[]);
      }
      setLoading(false);
    };

    loadEvents();
    return () => {
      mounted = false;
    };
  }, [projectId]);

  return (
    <Card className="p-5">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-600">Project Timeline</p>
        <h2 className="mt-1 text-xl font-black text-slate-950">Recent project activity</h2>
      </div>

      {loading && <div className="forge-panel-muted mt-5 p-4 text-sm font-semibold text-slate-700">Loading audit events...</div>}
      {error && <div className="mt-5 rounded-md border border-rose-300 bg-rose-100 p-4 text-sm font-bold text-rose-900">{error}</div>}
      {!loading && !error && events.length === 0 && (
        <div className="forge-panel-muted mt-5 p-4 text-sm font-semibold text-slate-700">No audit events recorded yet.</div>
      )}

      <div className="mt-5 space-y-2">
        {events.map((event) => (
          <div key={event.id} className="forge-event-log rounded-md border border-slate-300 p-3 pl-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-black text-slate-950">{event.action_type.replaceAll('_', ' ')}</p>
                <p className="text-xs font-semibold text-slate-600">
                  {event.technician_name} - {new Date(event.created_at).toLocaleString()}
                </p>
              </div>
              {(event.to_project_state || event.to_part_status) && (
                <span className="forge-pill px-2.5 py-1 text-xs text-slate-700">
                  {event.from_project_state || event.from_part_status || 'N/A'} -&gt; {event.to_project_state || event.to_part_status}
                </span>
              )}
            </div>
            {(event.reason || event.override_note) && (
              <p className="mt-2 rounded border border-[color:var(--forge-gold-border)] bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                {event.reason || event.override_note}
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
};

const DeleteProjectCard = ({
  project,
  deleting,
  onDelete
}: {
  project: Project;
  deleting: boolean;
  onDelete: () => Promise<void>;
}) => (
  <Card className="border-rose-200 bg-rose-50 p-4 print:hidden">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.14em] text-rose-700">Delete project</p>
        <p className="mt-1 text-sm text-rose-900">
          Deletes <span className="font-mono">{project.id}</span> and its {project.parts.length} part{project.parts.length === 1 ? '' : 's'}.
        </p>
      </div>
      <Button
        variant="destructive"
        size="sm"
        className="gap-2 self-start sm:self-center"
        onClick={() => void onDelete()}
        loading={deleting}
        loadingText="Deleting Project…"
      >
        <Trash2 size={16} />
        Delete project
      </Button>
    </div>
  </Card>
);
