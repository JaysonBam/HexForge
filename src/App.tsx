import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProviders, WorkspaceProviders } from './app/AppProviders';
import { AuthGuard } from './app/AuthGuard';
import { PublicThemeProvider } from './app/PublicThemeProvider';
import { Layout } from './components/Layout';

const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage').then((module) => ({ default: module.ProjectsPage })));
const ProjectTimeline = lazy(() => import('./pages/ProjectTimeline').then((module) => ({ default: module.ProjectTimeline })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const LoginPage = lazy(() => import('./pages/login/page'));
const AuthCallbackPage = lazy(() => import('./pages/auth-callback/page'));
const PublicAppInfoPage = lazy(() => import('./pages/public/LegalPages').then((module) => ({ default: module.PublicAppInfoPage })));
const PrivacyPolicyPage = lazy(() => import('./pages/public/LegalPages').then((module) => ({ default: module.PrivacyPolicyPage })));
const TermsOfServicePage = lazy(() => import('./pages/public/LegalPages').then((module) => ({ default: module.TermsOfServicePage })));

const routeFallback = (
  <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-sm font-bold text-slate-700">
    Loading...
  </div>
);

export default function App() {
  return (
    <AppProviders>
      <Suspense fallback={routeFallback}>
        <Routes>
          <Route path="/login" element={<PublicThemeProvider><LoginPage /></PublicThemeProvider>} />
          <Route path="/auth-callback" element={<PublicThemeProvider><AuthCallbackPage /></PublicThemeProvider>} />
          <Route path="/about" element={<PublicThemeProvider><PublicAppInfoPage /></PublicThemeProvider>} />
          <Route path="/privacy" element={<PublicThemeProvider><PrivacyPolicyPage /></PublicThemeProvider>} />
          <Route path="/terms" element={<PublicThemeProvider><TermsOfServicePage /></PublicThemeProvider>} />
          <Route
            path="/"
            element={(
              <AuthGuard>
                <WorkspaceProviders>
                  <Layout />
                </WorkspaceProviders>
              </AuthGuard>
            )}
          >
            <Route index element={<Dashboard />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="project/:id" element={<ProjectTimeline />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppProviders>
  );
}
