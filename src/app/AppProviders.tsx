import { BrowserRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { FeedbackProvider } from '../components/ui/FeedbackProvider';
import { ProjectProvider } from '../context/ProjectContext';
import { SettingsProvider } from '../context/SettingsContext';
import { StaffSessionProvider } from '../context/StaffSessionContext';
import { LocalHelperProvider } from '../local-files/LocalHelperContext';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <BrowserRouter>
      <FeedbackProvider>{children}</FeedbackProvider>
    </BrowserRouter>
  );
}

export function WorkspaceProviders({ children }: { children: ReactNode }) {
  return (
    <LocalHelperProvider>
      <ProjectProvider>
        <SettingsProvider>
          <StaffSessionProvider>
            {children}
          </StaffSessionProvider>
        </SettingsProvider>
      </ProjectProvider>
    </LocalHelperProvider>
  );
}
