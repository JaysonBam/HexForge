import { Outlet, Link, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { Button } from './ui/Button';
import { supabase } from '../lib/supabaseClient';
import { useProjects } from '../context/ProjectContext';
import { useSettings } from '../context/SettingsContext';
import { useStaffSession } from '../context/StaffSessionContext';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { getWorkspaceTabForState, type WorkspaceTab } from '../domain/operations';
import { LocalHelperIndicator } from '../local-files/LocalHelperIndicator';

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
  const { syncStatus, clearSyncError, getProject, projectsLoading } = useProjects();
  const { staffList } = useSettings();
  const { activeStaffName, setActiveStaffName, clearActiveStaffName } = useStaffSession();
  const location = useLocation();
  const navigate = useNavigate();
  const navListRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    let isMounted = true;

    const loadCurrentUser = async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
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
        const { data: profile } = await supabase
          .from('profiles')
          .select('profile_url')
          .eq('email', email)
          .maybeSingle();

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

    loadCurrentUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setProfileAvatarUrl(null);
        setProfileInitials('U');
        setIsProfileMenuOpen(false);
        return;
      }

      void loadCurrentUser();
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
      await supabase.auth.signOut();
      window.location.href = '/login';
    } catch (err) {
      console.error(err);
      window.location.href = '/login';
    }
  };

  return (
    <div className="forge-app-shell flex h-screen flex-col overflow-hidden text-slate-950">
      <header className="forge-header print:hidden shrink-0">
        <div className="flex w-full flex-col gap-4 px-4 py-3 sm:px-5 lg:px-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
            <div className="flex items-center gap-3 text-slate-950">
              <Link to="/" className="flex w-[9rem] shrink-0 items-center gap-2 text-slate-950">
                <img src="/favicon.svg" alt="" className="h-12 rounded-md object-contain" />
                <span className="text-lg font-extrabold tracking-[0.01em]">
                  Hex<span className="text-[color:var(--forge-gold)]">Forge</span>
                </span>
              </Link>
            </div>

            <nav
              aria-label="Primary navigation"
              ref={navListRef}
              className="forge-nav-shell relative flex flex-wrap items-center gap-1 p-1"
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
                const itemClassName = `relative z-10 flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors duration-200 ${
                  isActive
                    ? 'text-slate-950'
                    : 'text-slate-600 hover:text-slate-950'
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
                    >
                      <Icon size={16} className={isActive ? 'text-sky-600' : 'text-slate-500'} />
                      <span>{item.label}</span>
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
                  >
                    <Icon size={16} className={isActive ? 'text-sky-600' : 'text-slate-500'} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <LocalHelperIndicator />
            {syncStatus.saving && (
              <span className="forge-pill gap-2 px-3 py-1 text-xs text-slate-700">
                <span className="forge-energy-dot" aria-hidden="true" />
                Saving...
              </span>
            )}
            {syncStatus.error && (
              <div className="flex max-w-md items-center gap-2 rounded-full border border-rose-300 bg-rose-100 px-3 py-2 text-xs font-medium text-rose-800">
                <span className="truncate">{syncStatus.error}</span>
                <button
                  onClick={clearSyncError}
                  className="text-rose-500 transition-colors hover:text-rose-700"
                  aria-label="Dismiss sync error"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            <Button onClick={() => navigate('/project/new')} className="gap-2 shadow-sm" size="md">
              <Plus size={17} /> New Project
            </Button>

            <div className="forge-command-input flex min-w-[260px] items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <input
                  id="active-staff-name"
                  type="text"
                  value={activeStaffName}
                  onChange={(event) => setActiveStaffName(event.target.value)}
                  list="staff-header-list"
                  placeholder="Who is on this workstation?"
                  className="mt-1 w-full border-0 bg-transparent p-0 text-sm font-semibold text-slate-900 placeholder:text-slate-500 focus:outline-none"
                />
                <datalist id="staff-header-list">
                  {staffList.map((staffName) => <option key={staffName} value={staffName} />)}
                </datalist>
              </div>
              {activeStaffName && (
                <button
                  type="button"
                  onClick={clearActiveStaffName}
                  className="text-xs font-semibold text-slate-500 transition-colors hover:text-rose-600"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="relative z-[100]" data-profile-menu>
              <button
                type="button"
                onClick={() => setIsProfileMenuOpen((open) => !open)}
                className="forge-focus-ring flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-[color:var(--forge-gold-border)] bg-slate-100 shadow-sm transition-colors hover:bg-sky-50"
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
                  <span className="text-[11px] font-black tracking-[0.12em] text-slate-700">
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
                    className="flex w-full items-center rounded-md px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-sky-50 hover:text-slate-950"
                    role="menuitem"
                    onClick={() => setIsProfileMenuOpen(false)}
                  >
                    App overview
                  </Link>
                  <Link
                    to="/privacy"
                    className="flex w-full items-center rounded-md px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-sky-50 hover:text-slate-950"
                    role="menuitem"
                    onClick={() => setIsProfileMenuOpen(false)}
                  >
                    Privacy policy
                  </Link>
                  <Link
                    to="/terms"
                    className="flex w-full items-center rounded-md px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-sky-50 hover:text-slate-950"
                    role="menuitem"
                    onClick={() => setIsProfileMenuOpen(false)}
                  >
                    Terms
                  </Link>
                  <div className="my-1 h-px bg-slate-200" />
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-sky-50 hover:text-slate-950"
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


      <main className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain px-4 py-5 sm:px-5 lg:px-6 lg:py-6 print:p-0">
        <Outlet context={outletContext} />
      </main>
    </div>
  );
};
