import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { useProjects } from '../context/ProjectContext';
import {
  buildDashboardLanes,
  dashboardLaneMeta,
  getPartCounts,
  type DashboardLaneKey
} from '../domain/operations';
import {
  GmailAuthError,
  getUnread3dPrintEmailSummary,
  requestGmailReadAccess,
  type GmailUnreadPrintEmail,
  type GmailUnreadPrintEmailSummary
} from '../utils/gmailDraftUtils';
import { AlertTriangle, ExternalLink, RefreshCw, Search, Settings, X } from 'lucide-react';
import gmailIcon from '../assets/icons/gmail.svg';

const laneOrder: DashboardLaneKey[] = [
  'toBeConfirmed',
  'readyToPrint',
  'printing'
];

const laneEmptyCopy: Record<DashboardLaneKey, { title: string; description: string }> = {
  toBeConfirmed: {
    title: 'No projects',
    description: 'New incoming print requests will appear here.'
  },
  readyToPrint: {
    title: 'No projects',
    description: 'Projects ready for slicing and assignment will appear here.'
  },
  printing: {
    title: 'No projects',
    description: 'Active print jobs will appear here.'
  }
};

const emailReminderRefreshIntervalMs = 5 * 60 * 1000;

const projectMatchesSearch = (values: Array<string | undefined>, search: string) => {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) return true;

  return values.some((value) => value?.toLowerCase().includes(normalizedSearch));
};

type EmailReminderStatus = 'loading' | 'ready' | 'auth' | 'error';

type EmailReminderState = {
  status: EmailReminderStatus;
  summary: GmailUnreadPrintEmailSummary | null;
  message: string | null;
  isRefreshing: boolean;
};

let cachedEmailReminderState: EmailReminderState | null = null;
let cachedEmailReminderCheckedAtMs = 0;

const fetchEmailReminderState = async (): Promise<EmailReminderState> => {
  try {
    const summary = await getUnread3dPrintEmailSummary();
    return {
      status: 'ready',
      summary,
      message: null,
      isRefreshing: false
    };
  } catch (error) {
    console.error('Unread print email reminder failed', error);
    return {
      status: error instanceof GmailAuthError ? 'auth' : 'error',
      summary: null,
      message: error instanceof GmailAuthError
        ? 'Gmail read access is needed.'
        : 'Could not check Gmail.',
      isRefreshing: false
    };
  }
};

const getInitialEmailReminderState = (): EmailReminderState => (
  cachedEmailReminderState ?? {
    status: 'loading',
    summary: null,
    message: null,
    isRefreshing: true
  }
);

export const Dashboard = () => {
  const navigate = useNavigate();
  const { projects, projectsLoading, projectsLoadError } = useProjects();
  const [search, setSearch] = useState('');
  const [emailReminder, setEmailReminder] = useState<EmailReminderState>(getInitialEmailReminderState);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const emailReminderRefreshInFlightRef = useRef(false);

  const setCachedEmailReminder = useCallback((nextReminder: EmailReminderState) => {
    cachedEmailReminderState = nextReminder;
    if (nextReminder.summary?.checkedAt) {
      cachedEmailReminderCheckedAtMs = new Date(nextReminder.summary.checkedAt).getTime();
    }
    setEmailReminder(nextReminder);
  }, []);

  const loadEmailReminder = useCallback(async () => {
    if (emailReminderRefreshInFlightRef.current) {
      return;
    }

    emailReminderRefreshInFlightRef.current = true;

    setEmailReminder((previous) => ({
      status: previous.summary ? previous.status : 'loading',
      summary: previous.summary,
      message: previous.summary ? previous.message : null,
      isRefreshing: true
    }));

    const nextReminder = await fetchEmailReminderState();
    setCachedEmailReminder({
      ...nextReminder,
      summary: nextReminder.summary ?? cachedEmailReminderState?.summary ?? null,
      message: nextReminder.summary ? null : nextReminder.message,
      isRefreshing: false
    });
    emailReminderRefreshInFlightRef.current = false;
  }, [setCachedEmailReminder]);

  useEffect(() => {
    const refreshIfStale = () => {
      const shouldRefresh =
        !cachedEmailReminderState ||
        Date.now() - cachedEmailReminderCheckedAtMs >= emailReminderRefreshIntervalMs;

      if (shouldRefresh) {
        void loadEmailReminder();
      }
    };

    refreshIfStale();

    const intervalId = window.setInterval(() => {
      void loadEmailReminder();
    }, emailReminderRefreshIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadEmailReminder]);

  const visibleProjects = useMemo(() => (
    projects.filter((project) => projectMatchesSearch([
      project.id,
      project.studentName,
      project.studentNumber,
      project.course,
      project.lecturer
    ], search))
  ), [projects, search]);

  const lanes = useMemo(() => buildDashboardLanes(visibleProjects), [visibleProjects]);

  const totals = useMemo(() => {
    const operationalProjects = projects.filter((project) =>
      project.state !== 'CLOSED' &&
      project.state !== 'CANCELLED' &&
      project.state !== 'READY_FOR_COLLECTION' &&
      project.state !== 'PARTIALLY_COLLECTED'
    );
    const allParts = operationalProjects.flatMap((project) => project.parts);

    return {
      totalParts: allParts.length,
      inQueue: allParts.filter((part) => part.printStatus === 'READY' || part.printStatus === 'VERIFIED').length,
      printing: allParts.filter((part) => part.printStatus === 'PRINTING').length,
      printed: allParts.filter((part) => ['PRINTED', 'POST_PROCESSING'].includes(part.printStatus)).length
    };
  }, [projects]);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-5">
      <section className="flex flex-col gap-3">
        <div className="grid gap-3 lg:grid-cols-2 lg:items-stretch">
          <div className="relative flex min-w-0 items-center">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sky-600" size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search project code, student, module, lecturer"
              className="forge-command-input min-h-12 w-full pl-10 pr-3 text-sm font-semibold"
            />
          </div>

          <EmailReminderCard
            reminder={emailReminder}
            onOpen={() => setIsEmailModalOpen(true)}
            onRefresh={loadEmailReminder}
            onReconnect={requestGmailReadAccess}
          />
        </div>

        <div className="grid w-full gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <CompactMetric label="Total Plates" value={totals.totalParts} tone="text-slate-950" />
          <CompactMetric label="In Queue" value={totals.inQueue} tone="text-amber-700" />
          <CompactMetric label="Printing" value={totals.printing} tone="text-indigo-700" />
          <CompactMetric label="Printed" value={totals.printed} tone="text-emerald-700" />
        </div>
      </section>

      <section className="grid min-h-0 flex-1 gap-4 xl:auto-rows-fr xl:grid-cols-3">
        {laneOrder.map((laneKey) => {
          const lane = dashboardLaneMeta[laneKey];
          const laneProjects = lanes[laneKey];

          return (
            <div key={laneKey} className={lane.tone}>
              <div className="forge-lane-header flex items-center justify-between gap-3 px-4 py-3">
                <h2 className="text-[0.8rem] font-black uppercase tracking-[0.14em] text-slate-800">
                  {lane.title === 'Ready for Printing' ? 'Ready To Print' : lane.title}
                </h2>
                <span className="forge-lane-count">
                  {laneProjects.length}
                </span>
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {projectsLoading ? (
                  <DashboardLaneSkeleton />
                ) : laneProjects.length === 0 ? (
                  <LaneEmptyState laneKey={laneKey} />
                ) : (
                  laneProjects.map((project) => (
                    <ProjectRow key={project.id} project={project} onOpen={() => navigate(`/project/${project.id}`)} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </section>

      {!projectsLoading && projectsLoadError && (
        <div className="rounded-lg border border-rose-300 bg-rose-100 px-4 py-3 text-sm font-bold text-rose-900">
          {projectsLoadError}
        </div>
      )}

      {isEmailModalOpen && (
        <EmailReminderModal
          reminder={emailReminder}
          onClose={() => setIsEmailModalOpen(false)}
          onRefresh={loadEmailReminder}
        />
      )}
    </div>
  );
};

const SkeletonBar = ({ className = '' }: { className?: string }) => (
  <div className={`forge-skeleton rounded ${className}`} />
);

const DashboardLaneSkeleton = () => (
  <div className="space-y-3">
    {Array.from({ length: 3 }).map((_, index) => (
      <Card key={index} className="border-slate-200 bg-white px-4 py-3">
        <div className="flex items-start gap-4">
          <SkeletonBar className="h-10 w-16" />
          <div className="min-w-0 flex-1">
            <SkeletonBar className="h-6 w-2/3" />
            <SkeletonBar className="mt-2 h-3 w-1/2" />
          </div>
        </div>
        <SkeletonBar className="mt-5 h-16 w-full" />
      </Card>
    ))}
  </div>
);

const LaneEmptyState = ({ laneKey }: { laneKey: DashboardLaneKey }) => {
  const copy = laneEmptyCopy[laneKey];

  return (
    <div className="forge-lane-empty flex min-h-[24rem] flex-col items-center justify-center px-6 py-10 text-center">
      <Settings size={64} strokeWidth={1.35} className="text-slate-200" />
      <div className="mt-7 text-lg font-black text-slate-900">{copy.title}</div>
      <p className="mt-3 max-w-[16rem] text-sm font-semibold leading-7 text-slate-500">
        {copy.description}
      </p>
    </div>
  );
};

const formatEmailReminderTime = (checkedAt?: string) => {
  if (!checkedAt) return 'Not yet';

  const date = new Date(checkedAt);
  if (Number.isNaN(date.getTime())) return 'Not yet';

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatFlaggedEmailDate = (email: GmailUnreadPrintEmail) => {
  if (!email.receivedAt) {
    return email.dateHeader || 'Unknown date';
  }

  const date = new Date(email.receivedAt);
  if (Number.isNaN(date.getTime())) {
    return email.dateHeader || 'Unknown date';
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const EmailReminderCard = ({
  reminder,
  onOpen,
  onRefresh,
  onReconnect
}: {
  reminder: EmailReminderState;
  onOpen: () => void;
  onRefresh: () => void;
  onReconnect: () => void;
}) => {
  const count = reminder.summary?.count ?? null;
  const isLoading = reminder.status === 'loading' && !reminder.summary;
  const isRefreshing = reminder.isRefreshing;
  const isAuthBlocked = reminder.status === 'auth';
  const isError = reminder.status === 'error';
  const refreshedAt = formatEmailReminderTime(reminder.summary?.checkedAt);
  const emailSummaryText = isLoading
    ? 'Checking print emails'
    : reminder.status === 'ready' || reminder.summary
      ? `You have ${count ?? 0} unread print ${count === 1 ? 'email' : 'emails'}`
      : reminder.message || 'Could not check Gmail.';
  const emailActionLabel = isAuthBlocked ? 'Grant access' : isError ? 'Retry' : 'Open Gmail';

  return (
    <div
      className={`flex min-h-12 flex-col gap-2 rounded-lg border px-3 py-2 text-left shadow-sm sm:flex-row sm:items-center sm:justify-between ${
      isAuthBlocked || isError ? 'border-rose-300 bg-rose-50' : 'forge-metric'
    }`}
    >
      <div className="flex w-full min-w-0 flex-1 items-center gap-3 text-left sm:w-auto">
        <img src={gmailIcon} alt="" className="h-8 w-8 shrink-0" />
        <div className="min-w-0">
          <div className={`truncate text-sm font-bold ${
            isAuthBlocked || isError ? 'text-rose-900' : 'text-slate-950'
          }`}>
            {emailSummaryText}
          </div>
          <div className="mt-0.5 text-xs font-semibold text-slate-500">
            Last check: {refreshedAt}
          </div>
        </div>
      </div>

      <div className="flex w-full shrink-0 items-center justify-between gap-1.5 sm:w-auto sm:justify-end">
        {isAuthBlocked || isError ? (
          <button
            type="button"
            onClick={() => {
              if (isAuthBlocked) {
                onReconnect();
              } else {
                onRefresh();
              }
            }}
            className="inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-bold text-rose-800 transition hover:bg-rose-100 sm:flex-none"
          >
            <AlertTriangle size={16} />
            {emailActionLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-sky-500/30 bg-white px-2.5 py-1.5 text-xs font-bold text-sky-700 transition hover:bg-sky-50 sm:flex-none"
            aria-label="View unread print emails"
          >
            Open Gmail
            <ExternalLink size={14} />
          </button>
        )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="rounded-full p-1 text-slate-500 transition hover:bg-white hover:text-sky-700 disabled:cursor-wait disabled:opacity-60"
            aria-label="Refresh unread Gmail reminder"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
      </div>
    </div>
  );
};

const EmailReminderModal = ({
  reminder,
  onClose,
  onRefresh
}: {
  reminder: EmailReminderState;
  onClose: () => void;
  onRefresh: () => void;
}) => {
  const emails = reminder.summary?.flaggedEmails ?? [];
  const isLoading = reminder.status === 'loading' && !reminder.summary;
  const isRefreshing = reminder.isRefreshing;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-reminder-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="forge-modal flex max-h-[85vh] w-full max-w-2xl flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-slate-300 px-4 py-3">
          <div>
            <h2 id="email-reminder-modal-title" className="text-lg font-black text-slate-950">
              Unread Print Emails
            </h2>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Last refreshed {formatEmailReminderTime(reminder.summary?.checkedAt)}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 rounded-md border border-[color:var(--forge-gold-border)] bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-sky-50 disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-2 text-slate-500 transition hover:bg-sky-50 hover:text-slate-950"
              aria-label="Close unread print emails"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-4 py-3">
          {isLoading ? (
            <div className="forge-empty px-3 py-5 text-center text-sm font-semibold">
              Checking Gmail...
            </div>
          ) : reminder.status !== 'ready' && !reminder.summary ? (
            <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-5 text-center text-sm font-bold text-rose-800">
              {reminder.message || 'Could not check Gmail.'}
            </div>
          ) : emails.length === 0 ? (
            <div className="forge-empty px-3 py-5 text-center text-sm font-semibold">
              No unread print-related emails found.
            </div>
          ) : (
            <div className="space-y-2">
              {emails.map((email) => (
                <div key={email.id} className="forge-panel grid gap-3 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-black text-slate-950" title={email.subject}>
                      {email.subject}
                    </h3>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                      {formatFlaggedEmailDate(email)}
                    </p>
                  </div>
                  <a
                    href={email.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-sky-500/40 bg-slate-950 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
                  >
                    <ExternalLink size={14} />
                    Open in Gmail
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const CompactMetric = ({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: string;
}) => (
  <div className="forge-metric flex min-h-12 items-baseline gap-2 px-3.5 py-2.5 text-left">
    <div className={`text-2xl font-black leading-none ${tone}`}>{value}</div>
    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">{label}</div>
  </div>
);

const ProjectRow = ({ project, onOpen }: { project: ReturnType<typeof useProjects>['projects'][number]; onOpen: () => void }) => {
  const counts = getPartCounts(project);

  return (
    <Card
      className="forge-work-card group cursor-pointer px-3 py-3 transition hover:-translate-y-0.5 hover:border-[color:var(--forge-gold-border)] hover:shadow-md"
      onClick={onOpen}
    >
      <div className="flex items-start gap-3">
        <div className="forge-priority-large shrink-0 px-2 py-1.5 text-[1.2rem] font-black leading-none text-slate-950">
          #{project.priorityNumber}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[0.98rem] font-black leading-tight text-slate-950">
            {project.studentName || 'Unnamed Project'}
          </h3>
          <p className="mt-1 truncate text-xs font-semibold tracking-[0.04em] text-slate-500">
            {project.studentNumber || 'No student number'} {project.course ? `- ${project.course}` : ''}
          </p>
        </div>
      </div>

      <div className="mt-4 grid min-h-[3.55rem] grid-cols-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <StatusCell label={counts.total === 1 ? 'Part' : 'Parts'} value={counts.total} tone="text-sky-700" />
        <StatusCell label="Queue" value={counts.ready} tone="text-amber-700" withDivider />
        <StatusCell label="Printing" value={counts.printing} tone="text-indigo-700" withDivider />
        <StatusCell label="Printed" value={counts.printed} tone="text-emerald-700" withDivider />
      </div>
    </Card>
  );
};

const StatusCell = ({
  label,
  value,
  tone,
  withDivider = false
}: {
  label: string;
  value: number;
  tone: string;
  withDivider?: boolean;
}) => (
  <div className={`flex flex-col items-center justify-center px-1.5 py-1.5 text-center ${withDivider ? 'border-l border-slate-200' : ''}`}>
    <div className={`text-[1.35rem] font-black leading-none ${tone}`}>{value}</div>
    <div className="mt-1 text-[0.56rem] font-black uppercase tracking-[0.1em] text-slate-500">{label}</div>
  </div>
);
