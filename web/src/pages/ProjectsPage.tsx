import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { StateBadge } from '../components/StateBadge';
import { useProjects } from '../context/ProjectContext';
import { projectStateMeta } from '../domain/operations';
import type { ProjectState } from '../types';
import {
  downloadCollectionReportXlsx,
  getCollectionReportRows,
  getPartCollectionTimestamp
} from '../utils/collectionReportXlsx';
import {
  ArrowRight,
  Calendar,
  ChevronDown,
  Download,
  FileSpreadsheet,
  ListFilter,
  Search,
  X
} from 'lucide-react';

const filterOptions: { label: string; value: string }[] = [
  { label: 'All States', value: 'All' },
  ...Object.entries(projectStateMeta).map(([value, meta]) => ({
    label: meta.label,
    value
  }))
];

const projectMatchesFilter = (projectState: ProjectState, activeFilter: string) => {
  if (activeFilter === 'All') return true;
  return projectState === activeFilter;
};

const formatMonthValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const formatMonthLabel = (monthValue: string) => {
  const [year, month] = monthValue.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric'
  });
};

export const ProjectsPage = () => {
  const navigate = useNavigate();
  const { projects, projectsLoading, projectsLoadError, activeFilter, setActiveFilter } = useProjects();
  const [search, setSearch] = useState('');
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [selectedReportMonth, setSelectedReportMonth] = useState(() => formatMonthValue(new Date()));
  const [reportExporting, setReportExporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const yearOptions = useMemo(() => {
    const projectYears = projects
      .map((project) => new Date(project.createdAt).getFullYear())
      .filter((year) => Number.isFinite(year));

    const currentYear = new Date().getFullYear();
    const minYear = projectYears.length > 0 ? Math.min(...projectYears, currentYear) : currentYear;
    const maxYear = projectYears.length > 0 ? Math.max(...projectYears, currentYear) : currentYear;

    return Array.from(
      { length: maxYear - minYear + 1 },
      (_, index) => maxYear - index
    );
  }, [projects]);

  const collectionMonthOptions = useMemo(() => {
    const monthSet = new Set<string>();

    projects.forEach((project) => {
      project.parts
        .filter((part) => part.printStatus === 'COLLECTED')
        .forEach((part) => {
          const timestamp = getPartCollectionTimestamp(project, part);
          if (timestamp) {
            monthSet.add(formatMonthValue(timestamp));
          }
        });
    });

    const months = [...monthSet].sort((a, b) => b.localeCompare(a));
    return months.length > 0 ? months : [formatMonthValue(new Date())];
  }, [projects]);

  const reportRows = useMemo(
    () => getCollectionReportRows(projects, selectedReportMonth),
    [projects, selectedReportMonth]
  );

  const visibleProjects = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return [...projects]
      .filter((project) => {
        if (new Date(project.createdAt).getFullYear() !== selectedYear) return false;
        if (!projectMatchesFilter(project.state, activeFilter)) return false;
        if (!normalizedSearch) return true;

        return [
          project.id,
          project.studentName,
          project.studentNumber,
          project.course,
          project.lecturer,
          project.printLabel
        ].some((value) => value?.toLowerCase().includes(normalizedSearch));
      })
      .sort((a, b) => a.priorityNumber - b.priorityNumber || a.createdAt.localeCompare(b.createdAt));
  }, [activeFilter, projects, search, selectedYear]);

  const openReportModal = () => {
    setSelectedReportMonth((currentMonth) =>
      collectionMonthOptions.includes(currentMonth) ? currentMonth : collectionMonthOptions[0]
    );
    setReportError(null);
    setReportModalOpen(true);
  };

  const handleReportDownload = async () => {
    setReportExporting(true);
    setReportError(null);

    try {
      await downloadCollectionReportXlsx(reportRows, selectedReportMonth);
      setReportModalOpen(false);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : 'Failed to create the Excel report.');
    } finally {
      setReportExporting(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-5">
      <section className="forge-panel flex flex-col gap-3 p-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] xl:items-center">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sky-600" size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search project code, student, module, lecturer, collection code"
              className="forge-command-input h-10 w-full pl-10 pr-3 text-sm font-semibold"
            />
          </div>

          <div className="relative">
            <ListFilter className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sky-600" size={15} />
            <select
              id="projects-state-filter"
              value={activeFilter}
              onChange={(event) => setActiveFilter(event.target.value)}
              className="forge-command-input h-10 min-w-[210px] appearance-none pl-10 pr-10 text-sm font-semibold"
            >
              {filterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          </div>

          <div className="relative">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sky-600" size={15} />
            <select
              id="projects-year-filter"
              value={selectedYear}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
              className="forge-command-input h-10 min-w-[150px] appearance-none pl-10 pr-10 text-sm font-semibold"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          </div>

          <span className="forge-pill px-3 py-1 text-xs text-slate-700">
            {visibleProjects.length} shown
          </span>

          <Button type="button" variant="outline" className="gap-2" onClick={openReportModal}>
            <Download size={16} />
            Download report
          </Button>
        </div>
      </section>

      <section className="space-y-2.5">
        {projectsLoading ? (
          <ProjectsListSkeleton />
        ) : projectsLoadError ? (
          <div className="rounded-lg border border-rose-300 bg-rose-100 px-6 py-5 text-sm font-bold text-rose-900">
            {projectsLoadError}
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className="forge-empty px-6 py-10 text-center text-sm font-semibold">
            No projects match the current year, search, and state filter.
          </div>
        ) : (
          visibleProjects.map((project) => (
            <ProjectListRow key={project.id} project={project} onOpen={() => navigate(`/project/${project.id}`)} />
          ))
        )}
      </section>

      {reportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-[2px]">
          <div className="forge-modal w-full max-w-md">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div className="flex min-w-0 gap-3">
                <div className="forge-stamp flex h-10 w-10 shrink-0 items-center justify-center text-white">
                  <FileSpreadsheet size={19} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-black text-slate-950">Download collection report</h2>
                  <p className="mt-1 text-sm font-medium text-slate-600">
                    Select the collection month to export as a formatted Excel sheet.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReportModalOpen(false)}
                className="rounded-md p-1.5 text-slate-500 transition hover:bg-sky-50 hover:text-slate-950"
                aria-label="Close report dialog"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <label className="block">
                <span className="text-xs font-black uppercase tracking-wide text-slate-600">Report month</span>
                <select
                  value={selectedReportMonth}
                  onChange={(event) => setSelectedReportMonth(event.target.value)}
                  className="forge-command-input mt-2 h-11 w-full px-3 text-sm font-semibold"
                >
                  {collectionMonthOptions.map((monthValue) => (
                    <option key={monthValue} value={monthValue}>
                      {formatMonthLabel(monthValue)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="forge-panel-muted px-4 py-3">
                <div className="text-sm font-black text-slate-950">
                  {reportRows.length} collected {reportRows.length === 1 ? 'part' : 'parts'}
                </div>
                <div className="mt-1 text-xs font-medium text-slate-600">
                  Each collected part or plate is exported as an individual project row.
                </div>
              </div>

              {reportError && (
                <div className="rounded-md border border-rose-300 bg-rose-100 px-4 py-3 text-sm font-bold text-rose-900">
                  {reportError}
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setReportModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                className="gap-2"
                disabled={reportRows.length === 0 || reportExporting}
                onClick={handleReportDownload}
                loading={reportExporting}
                loadingText="Preparing Report…"
              >
                <Download size={16} />
                Download Excel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SkeletonBar = ({ className = '' }: { className?: string }) => (
  <div className={`forge-skeleton rounded ${className}`} />
);

const ProjectsListSkeleton = () => (
  <>
    {Array.from({ length: 6 }).map((_, index) => (
      <Card key={index} className="border-slate-300 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <SkeletonBar className="h-7 w-14 shrink-0 bg-slate-300" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <SkeletonBar className="h-4 w-36" />
              <SkeletonBar className="h-3 w-24" />
              <SkeletonBar className="h-3 w-20" />
            </div>
          </div>
          <div className="hidden min-w-0 items-center gap-2 md:flex">
            <SkeletonBar className="h-7 w-24 rounded-full" />
            <SkeletonBar className="h-7 w-20 rounded-full" />
          </div>
          <SkeletonBar className="h-4 w-4 shrink-0" />
        </div>
      </Card>
    ))}
  </>
);

const ProjectListRow = ({ project, onOpen }: { project: ReturnType<typeof useProjects>['projects'][number]; onOpen: () => void }) => (
  <Card
    className="group cursor-pointer px-4 py-3 transition hover:border-[color:var(--forge-gold-border)] hover:shadow-md"
    onClick={onOpen}
  >
    <div className="flex items-center gap-3">
      <div className="forge-stamp min-w-[56px] px-2 py-1 text-center text-xs font-black">
        #{project.priorityNumber}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="truncate text-sm font-black text-slate-950">
            {project.studentName || 'Unnamed Project'}
          </h3>
          <span className="text-xs font-semibold text-slate-500">
            {project.studentNumber || 'No student number'}
          </span>
          {project.course && (
            <span className="truncate text-xs font-semibold text-slate-500">
              {project.course}
            </span>
          )}
          {project.lecturer && (
            <span className="truncate text-xs font-semibold text-slate-500">
              {project.lecturer}
            </span>
          )}
        </div>
      </div>

      <div className="hidden min-w-0 items-center gap-2 md:flex">
        <StateBadge state={project.state} />
        {project.printLabel?.trim() && (
          <span className="forge-badge forge-badge-green px-2.5 py-1 text-[11px]">
            {project.printLabel.trim()}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 md:hidden">
        <StateBadge state={project.state} />
      </div>

      <ArrowRight size={17} className="shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-800" />
    </div>

    {project.printLabel?.trim() && (
      <div className="mt-2 md:hidden">
        <span className="forge-badge forge-badge-green px-2.5 py-1 text-[11px]">
          {project.printLabel.trim()}
        </span>
      </div>
    )}
  </Card>
);
