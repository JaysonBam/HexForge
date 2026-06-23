import { BrowserRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { FeedbackProvider } from '../components/ui/FeedbackProvider';
import { ProjectProvider } from '../context/ProjectContext';
import { SettingsProvider } from '../context/SettingsContext';
import { StaffSessionProvider } from '../context/StaffSessionContext';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ProjectProvider>
      <SettingsProvider>
        <StaffSessionProvider>
          <BrowserRouter>
            <FeedbackProvider>{children}</FeedbackProvider>
          </BrowserRouter>
        </StaffSessionProvider>
      </SettingsProvider>
    </ProjectProvider>
  );
}
