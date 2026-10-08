// Development origins are separate so enabling a local benchmark never replaces
// the production allowlist. Only explicit loopback HTTP origins are accepted.
export const configuredWebOrigins = (production: string, local = '') => {
  const origins = production.split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean);
  for (const value of local.split(',')) {
    const origin = value.trim().replace(/\/$/, '');
    const match = origin.match(/^http:\/\/(localhost|127\.0\.0\.1):(\d{1,5})$/);
    if (match) {
      const port = Number(match[2]);
      if (port >= 1 && port <= 65535) origins.push(origin);
    }
  }
  return [...new Set(origins)];
};
