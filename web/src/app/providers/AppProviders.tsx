import { BrowserRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { FeedbackProvider } from './FeedbackProvider';
import { ProjectProvider } from '@/features/projects/context/ProjectContext';
import { SettingsProvider } from '@/features/settings/context/SettingsContext';
import { StaffSessionProvider } from '@/features/auth/context/StaffSessionContext';
import { LocalHelperProvider } from '@/features/local-files/LocalHelperContext';

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
