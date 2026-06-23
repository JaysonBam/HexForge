import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProviders } from './app/AppProviders';
import { AuthGuard } from './app/AuthGuard';
import { PublicThemeProvider } from './app/PublicThemeProvider';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectTimeline } from './pages/ProjectTimeline';
import { SettingsPage } from './pages/SettingsPage';
import {
  PrivacyPolicyPage,
  PublicAppInfoPage,
  TermsOfServicePage
} from './pages/public/LegalPages';
import LoginPage from './pages/login/page';
import AuthCallbackPage from './pages/auth-callback/page';

export default function App() {
  return (
    <AppProviders>
      <Routes>
        <Route path="/login" element={<PublicThemeProvider><LoginPage /></PublicThemeProvider>} />
        <Route path="/auth-callback" element={<PublicThemeProvider><AuthCallbackPage /></PublicThemeProvider>} />
        <Route path="/about" element={<PublicThemeProvider><PublicAppInfoPage /></PublicThemeProvider>} />
        <Route path="/privacy" element={<PublicThemeProvider><PrivacyPolicyPage /></PublicThemeProvider>} />
        <Route path="/terms" element={<PublicThemeProvider><TermsOfServicePage /></PublicThemeProvider>} />
        <Route path="/" element={<AuthGuard><Layout /></AuthGuard>}>
          <Route index element={<Dashboard />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="project/:id" element={<ProjectTimeline />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppProviders>
  );
}
