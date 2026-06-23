import type { ProjectState } from '../types';
import { projectStateMeta } from '../domain/operations';

export const StateBadge = ({ state }: { state: ProjectState }) => {
  const meta = projectStateMeta[state] || projectStateMeta.INTAKE;

  return (
    <span className={`forge-badge px-2.5 py-1 text-xs ${meta.tone}`}>
      {meta.label}
    </span>
  );
};
