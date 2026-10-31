import { Outlet, Link, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { ThemeToggle } from '@/components/ui/ThemeControls';
import {
  signOut,
  subscribeToAuthChanges
} from '@/api/supabase/auth';
import { getProfileAvatarByEmail } from '@/api/supabase/profiles';
import { useProjects } from '@/features/projects/context/ProjectContext';
import { useSettings } from '@/features/settings/context/SettingsContext';
import { useStaffSession } from '@/features/auth/context/StaffSessionContext';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Boxes,
  CreditCard,
  House,
  LayoutDashboard,
  Layers3,
  LogOut,
  PackageCheck,
  Plus,
  Printer,
  Settings as SettingsIcon,
  X,
  type LucideIcon
} from 'lucide-react';
import { getWorkspaceTabForState, type WorkspaceTab } from '@/domain/operations';
import { useGmailInboxRefresh } from '@/features/gmail/useGmailInbox';
import { LocalHelperIndicator } from '@/features/local-files/LocalHelperIndicator';

type NavigationItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  to?: string;
  tab?: WorkspaceTab;
};

export type ProjectWorkspaceNavigationContext = {
  activeWorkspaceTab: WorkspaceTab;
  selectWorkspaceTab: (tab: WorkspaceTab) => void;
};

const mainNavItems: NavigationItem[] = [
  { id: 'home', label: 'Home', to: '/', icon: House },
  { id: 'projects', label: 'Projects', to: '/projects', icon: Layers3 },
  { id: 'settings', label: 'Settings', to: '/settings', icon: SettingsIcon }
];

const projectWorkspaceNavItems: NavigationItem[] = [
  { id: 'overview', label: 'Overview', tab: 'overview', icon: LayoutDashboard },
  { id: 'parts', label: 'Parts', tab: 'parts', icon: Boxes },
  { id: 'quote', label: 'Payments', tab: 'quote', icon: CreditCard },
  { id: 'production', label: 'Production', tab: 'production', icon: Printer },
  { id: 'collection', label: 'Collection', tab: 'collection', icon: PackageCheck }
];

const readString = (value: unknown) => typeof value === 'string' && value.trim().length > 0
  ? value
  : null;

const getUserMetadataString = (metadata: Record<string, unknown> | undefined, keys: string[]) => {
  for (const key of keys) {
    const value = readString(metadata?.[key]);
    if (value) return value;
  }

  return null;
};

const getGoogleIdentityDataString = (
  identities: Array<{ provider?: string; identity_data?: Record<string, unknown> }> | undefined,
  keys: string[]
) => {
  const googleIdentity = identities?.find((identity) => identity.provider === 'google') ?? identities?.[0];
  const identityData = googleIdentity?.identity_data;

  for (const key of keys) {
    const value = readString(identityData?.[key]);
    if (value) return value;
  }

  return null;
};

export const Layout = () => {
  useGmailInboxRefresh();
  const { syncStatus, clearSyncError, getProject, projectsLoading } = useProjects();
  const { staffList } = useSettings();
  const { activeStaffName, setActiveStaffName, clearActiveStaffName } = useStaffSession();
  const location = useLocation();
  const navigate = useNavigate();
  const navListRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(72);
  const navItemRefs = useRef<Record<string, HTMLElement | null>>({});
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profileInitials, setProfileInitials] = useState('U');
  const [selectedWorkspaceTab, setSelectedWorkspaceTab] = useState<{
    locationKey: string;
    projectId: string;
    tab: WorkspaceTab;
  } | null>(null);

  const projectRouteMatch = matchPath('/project/:id', location.pathname);
  const projectRouteId = projectRouteMatch?.params.id;
  const isNewProjectRoute = projectRouteId === 'new';
  const isProjectWorkspacePath = Boolean(projectRouteId && projectRouteId !== 'new');
  const projectForNavigation = isProjectWorkspacePath && projectRouteId
    ? getProject(projectRouteId)
    : undefined;
  const isProjectWorkspaceRoute = Boolean(isProjectWorkspacePath && (projectsLoading || projectForNavigation));
  const defaultWorkspaceTab = projectForNavigation
    ? getWorkspaceTabForState(projectForNavigation.state)
    : 'overview';
  const activeWorkspaceTab = selectedWorkspaceTab?.locationKey === location.key
    && selectedWorkspaceTab.projectId === projectRouteId
    ? selectedWorkspaceTab.tab
    : defaultWorkspaceTab;

  const selectWorkspaceTab = useCallback((tab: WorkspaceTab) => {
    if (!projectRouteId || projectRouteId === 'new') return;
    setSelectedWorkspaceTab({ locationKey: location.key, projectId: projectRouteId, tab });
  }, [location.key, projectRouteId]);

  const navItems = isProjectWorkspaceRoute ? projectWorkspaceNavItems : mainNavItems;

  const activeNavItem = useMemo(() => {
    if (isProjectWorkspaceRoute) {
      return projectWorkspaceNavItems.find((item) => item.tab === activeWorkspaceTab) ?? projectWorkspaceNavItems[0];
    }

    return mainNavItems.find((item) => {
      if (item.id === 'home') return location.pathname === '/';
      if (item.id === 'projects') {
        return location.pathname.startsWith('/projects') || location.pathname.startsWith('/project');
      }
      return item.to ? location.pathname.startsWith(item.to) : false;
    }) ?? mainNavItems[0];
  }, [activeWorkspaceTab, isProjectWorkspaceRoute, location.pathname]);

  const outletContext = useMemo<ProjectWorkspaceNavigationContext>(() => ({
    activeWorkspaceTab,
    selectWorkspaceTab
  }), [activeWorkspaceTab, selectWorkspaceTab]);

  useLayoutEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [location.pathname, activeWorkspaceTab]);

  useEffect(() => {
    let isMounted = true;

    const loadCurrentUser = async (user: import('@supabase/supabase-js').User) => {
      if (!user) {
        if (!isMounted) {
          return;
        }
        setProfileAvatarUrl(null);
        setProfileInitials('U');
        return;
      }

      const email = user.email;
      if (!isMounted) {
        return;
      }

      const metadata = user.user_metadata as Record<string, unknown> | undefined;
      const identities = user.identities as Array<{ provider?: string; identity_data?: Record<string, unknown> }> | undefined;
      const fullName = getUserMetadataString(metadata, ['full_name', 'name'])
        ?? getGoogleIdentityDataString(identities, ['full_name', 'name'])
        ?? email
        ?? 'User';
      const avatarFromAuthUser = getUserMetadataString(metadata, ['avatar_url', 'picture'])
        ?? getGoogleIdentityDataString(identities, ['avatar_url', 'picture']);

      let avatarUrl = avatarFromAuthUser;
      if (email) {
        const { data: profile } = await getProfileAvatarByEmail(email);

        if (!isMounted) {
          return;
        }

        if (profile && typeof profile.profile_url === 'string' && profile.profile_url.length > 0) {
          avatarUrl = profile.profile_url;
        }
      }

      setProfileAvatarUrl(avatarUrl);
      setProfileInitials(
        fullName
          .split(' ')
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() ?? '')
          .join('') || 'U'
      );
    };

    const subscription = subscribeToAuthChanges((_event, session) => {
      if (!session) {
        setProfileAvatarUrl(null);
        setProfileInitials('U');
        setIsProfileMenuOpen(false);
        return;
      }

      // Header identity is display data. The authenticated session already has
      // it; avoid two getUser requests that lock and delay all database reads.
      void loadCurrentUser(session.user);
    });

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (!navListRef.current?.contains(target) && !(target instanceof Element && target.closest('[data-profile-menu]'))) {
        setIsProfileMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsProfileMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  useLayoutEffect(() => {
    const updateIndicator = () => {
      const activeElement = navItemRefs.current[activeNavItem.id];
      const navElement = navListRef.current;

      if (!activeElement || !navElement) {
        setIndicatorStyle(null);
        return;
      }

      const navRect = navElement.getBoundingClientRect();
      const itemRect = activeElement.getBoundingClientRect();
      setIndicatorStyle({
        left: itemRect.left - navRect.left,
        width: itemRect.width
      });
    };

    updateIndicator();
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [activeNavItem.id, location.pathname]);

  const handleLogout = async () => {
    try {
      await signOut();
      window.location.href = '/login';
    } catch (err) {
      console.error(err);
      window.location.href = '/login';
    }
  };

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () => setHeaderHeight(header.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="forge-app-shell flex h-screen flex-col overflow-hidden text-slate-950 dark:text-slate-100" style={{ '--forge-header-height': `${headerHeight}px` } as CSSProperties}>
      <header ref={headerRef} className="forge-header print:hidden shrink-0">
        <div className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5 lg:px-6">
          <div className="flex min-w-0 max-w-full shrink-0 items-center gap-4">
            <div className="flex items-center gap-3 text-slate-950 dark:text-slate-100">
              <Link to="/" aria-label="HexForge home" className="flex w-auto shrink-0 items-center gap-2 text-slate-950 dark:text-slate-100 sm:w-[9rem]">
                <img src="/favicon.svg" alt="" className="h-12 rounded-md object-contain" />
                <span className="hidden text-lg font-extrabold tracking-[0.01em] sm:inline">
                  Hex<span className="text-[color:var(--forge-gold)]">Forge</span>
                </span>
              </Link>
            </div>

            <nav
              aria-label="Primary navigation"
              ref={navListRef}
              className="forge-nav-shell relative flex flex-nowrap items-center gap-1 p-1"
            >
              {indicatorStyle && (
                <span
                  aria-hidden="true"
                  className="forge-nav-indicator pointer-events-none absolute top-1 bottom-1 rounded-md transition-[left,width] duration-300 ease-out"
                  style={{
                    left: indicatorStyle.left,
                    width: indicatorStyle.width
                  }}
                />
              )}
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === activeNavItem.id;
                const itemClassName = `relative z-10 flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors duration-200 max-[1440px]:px-3 ${
                  isActive
                    ? 'text-slate-950 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-slate-100'
                }`;

                if (item.tab) {
                  return (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => selectWorkspaceTab(item.tab!)}
                      ref={(node) => {
                        navItemRefs.current[item.id] = node;
                      }}
                      className={itemClassName}
                      aria-current={isActive ? 'page' : undefined}
                      title={item.label}
                    >
                      <Icon size={16} className={isActive ? 'text-sky-600 dark:text-sky-400' : 'text-slate-500 dark:text-slate-400'} />
                      <span className={isProjectWorkspaceRoute ? 'max-[1440px]:hidden' : 'max-[1024px]:hidden'}>{item.label}</span>
                    </button>
                  );
                }

                return (
                  <Link
                    key={item.id}
                    to={item.to ?? '/'}
                    ref={(node) => {
                      navItemRefs.current[item.id] = node;
                    }}
                    className={itemClassName}
                    aria-current={isActive ? 'page' : undefined}
                    title={item.label}
                  >
                    <Icon size={16} className={isActive ? 'text-sky-600 dark:text-sky-400' : 'text-slate-500 dark:text-slate-400'} />
                    <span className="max-[1024px]:hidden">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex w-full min-w-0 max-w-full flex-wrap items-center justify-end gap-3 sm:w-auto">
            <LocalHelperIndicator />
            <ThemeToggle />
            {syncStatus.saving && (
              <span className="forge-pill gap-2 px-3 py-1 text-xs text-slate-700 dark:text-slate-300">
                <span className="forge-energy-dot" aria-hidden="true" />
                Saving...
              </span>
            )}
            {syncStatus.error && (
              <div className="flex max-w-md items-center gap-2 rounded-full border border-rose-300 dark:border-rose-800 bg-rose-100 dark:bg-rose-950/55 px-3 py-2 text-xs font-medium text-rose-800 dark:text-rose-200">
                <span className="truncate">{syncStatus.error}</span>
                <button
                  onClick={clearSyncError}
                  className="text-rose-500 dark:text-rose-400 transition-colors hover:text-rose-700 dark:hover:text-rose-300"
                  aria-label="Dismiss sync error"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {!isProjectWorkspaceRoute && (
              <Button
                type={isNewProjectRoute ? 'submit' : 'button'}
                form={isNewProjectRoute ? 'new-project-form' : undefined}
                onClick={isNewProjectRoute ? undefined : () => navigate('/project/new')}
                className="gap-2 shadow-sm"
                size="md"
                aria-label={isNewProjectRoute ? 'Create Project' : 'New Project'}
              >
                <Plus size={17} /><span className="hidden min-[360px]:inline">{isNewProjectRoute ? 'Create Project' : 'New Project'}</span>
              </Button>
            )}

            <div className="forge-command-input order-last flex w-full min-w-0 items-center gap-2 px-3 py-2 sm:order-none sm:w-auto sm:min-w-[260px]">
              <div className="min-w-0 flex-1">
                <input
                  id="active-staff-name"
                  type="text"
                  value={activeStaffName}
                  onChange={(event) => setActiveStaffName(event.target.value)}
                  list="staff-header-list"
                  placeholder="Who is on this workstation?"
                  className="mt-1 w-full border-0 bg-transparent p-0 text-sm font-semibold text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none"
                />
                <datalist id="staff-header-list">
                  {staffList.map((staffName) => <option key={staffName} value={staffName} />)}
                </datalist>
              </div>
              {activeStaffName && (
                <button
                  type="button"
                  onClick={clearActiveStaffName}
                  className="text-xs font-semibold text-slate-500 dark:text-slate-400 transition-colors hover:text-rose-600 dark:hover:text-rose-400"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="relative z-[100]" data-profile-menu>
              <button
                type="button"
                onClick={() => setIsProfileMenuOpen((open) => !open)}
                className="forge-focus-ring flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-[color:var(--forge-gold-border)] bg-slate-100 dark:bg-slate-900 shadow-sm transition-colors hover:bg-sky-50 dark:hover:bg-sky-950/40"
                aria-haspopup="menu"
                aria-expanded={isProfileMenuOpen}
                aria-label="Open account menu"
              >
                {profileAvatarUrl ? (
                  <img
                    src={profileAvatarUrl}
                    alt="Open account menu"
                    referrerPolicy="no-referrer"
                    onError={() => {
                      console.warn('Profile avatar image failed to load', { profileAvatarUrl });
                      setProfileAvatarUrl(null);
                    }}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-[11px] font-black tracking-[0.12em] text-slate-700 dark:text-slate-300">
                    {profileInitials}
                  </span>
                )}
              </button>

              {isProfileMenuOpen && (
                <div
                  role="menu"
                  className="forge-modal absolute right-0 z-[100] mt-2 w-44 p-1"
                >
                  <Link
                    to="/about"
                    className="flex w-full items-center rounded-md px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 transition-colors hover:bg-sky-50 dark:hover:bg-sky-950/40 hover:text-slate-950 dark:hover:text-slate-100"
                    role="menuitem"
                    onClick={() => setIsProfileMenuOpen(false)}
                  >
                    App overview
                  </Link>
                  <Link
                    to="/privacy"
                    className="flex w-full items-center rounded-md px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 transition-colors hover:bg-sky-50 dark:hover:bg-sky-950/40 hover:text-slate-950 dark:hover:text-slate-100"
                    role="menuitem"
                    onClick={() => setIsProfileMenuOpen(false)}
                  >
                    Privacy policy
                  </Link>
                  <Link
                    to="/terms"
                    className="flex w-full items-center rounded-md px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 transition-colors hover:bg-sky-50 dark:hover:bg-sky-950/40 hover:text-slate-950 dark:hover:text-slate-100"
                    role="menuitem"
                    onClick={() => setIsProfileMenuOpen(false)}
                  >
                    Terms
                  </Link>
                  <div className="my-1 h-px bg-slate-200 dark:bg-slate-700" />
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 transition-colors hover:bg-sky-50 dark:hover:bg-sky-950/40 hover:text-slate-950 dark:hover:text-slate-100"
                    role="menuitem"
                  >
                    <LogOut size={16} />
                    Sign out
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
      </header>


      <main ref={mainRef} className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain px-4 py-5 sm:px-5 lg:px-6 lg:py-6 print:p-0">
        <Outlet context={outletContext} />
      </main>
    </div>
  );
};
