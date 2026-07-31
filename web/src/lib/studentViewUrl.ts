const getStudentViewBaseUrl = () => {
  const viteEnv = (import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }).env?.VITE_STUDENT_VIEW_URL;
  const nodeEnv = typeof process !== 'undefined' ? process.env.VITE_STUDENT_VIEW_URL : undefined;
  return viteEnv || nodeEnv;
};

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, '');

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const getStudentViewUrl = (projectId: string) => {
  const normalizedProjectId = projectId.trim();
  const studentViewBaseUrl = getStudentViewBaseUrl();
  const normalizedBaseUrl = studentViewBaseUrl ? normalizeBaseUrl(studentViewBaseUrl) : '';

  if (!normalizedBaseUrl || !normalizedProjectId) return '';
  return `${normalizedBaseUrl}/${encodeURIComponent(normalizedProjectId)}`;
};

export const getStudentViewEmailHtml = (projectId: string) => {
  const studentViewUrl = getStudentViewUrl(projectId);
  if (!studentViewUrl) return '';

  return `<p>View your print overview and status: <a href="${escapeHtml(studentViewUrl)}">View your print</a></p>`;
};
