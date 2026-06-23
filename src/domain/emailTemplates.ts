import type { Project } from '../types';

export type EmailTemplateKey =
  | 'quote_payment_required'
  | 'quote_no_payment_required'
  | 'collection_payment_reminder'
  | 'collection_ready';

export type EmailEditorSelection = EmailTemplateKey | 'signature';

export type EmailTokenType = 'student_name' | 'project_number' | 'project_link';

export interface EmailTemplate {
  key: EmailTemplateKey;
  subject: string;
  htmlBody: string;
  attachQuote: boolean;
  includeSignature: boolean;
}

export type EmailTemplates = Record<EmailTemplateKey, EmailTemplate>;

export interface EmailSignature {
  html: string;
}

export interface RenderedEmail {
  subject: string;
  htmlBody: string;
  plainBody: string;
  attachQuote: boolean;
}

export const emailTemplateLabels: Record<EmailEditorSelection, string> = {
  quote_payment_required: 'Quote - payment required',
  quote_no_payment_required: 'Quote - no payment required',
  collection_payment_reminder: 'Collection - payment reminder',
  collection_ready: 'Collection - ready',
  signature: 'Global signature'
};

export const emailTemplateKeys: EmailTemplateKey[] = [
  'quote_payment_required',
  'quote_no_payment_required',
  'collection_payment_reminder',
  'collection_ready'
];

export const defaultEmailSignature: EmailSignature = {
  html: '<p>Kind regards,</p>'
};

export const defaultEmailTemplates: EmailTemplates = {
  quote_payment_required: {
    key: 'quote_payment_required',
    subject: 'MISC 3D Printing Quote - Project #{{project_number}}',
    attachQuote: true,
    includeSignature: true,
    htmlBody: [
      '<p>Good day <span data-email-token="student_name"></span>,</p>',
      '<p>Your print job has been processed, and the quotation is attached. Please review the quotation. If you have any questions or concerns, just let us know.</p>',
      '<p>The quotation is payable at the Client Service Center (CSC) under the Humanities building, to the Cost Centre Account as specified in the quotation.</p>',
      '<p>A copy of the receipt is required to start your print.</p>',
      '<p>View your print overview and status: <span data-email-token="project_link" data-label="View your print"></span></p>'
    ].join('')
  },
  quote_no_payment_required: {
    key: 'quote_no_payment_required',
    subject: 'MISC 3D Printing Update - Project #{{project_number}}',
    attachQuote: false,
    includeSignature: true,
    htmlBody: [
      '<p>Good day <span data-email-token="student_name"></span>,</p>',
      '<p>Your print has been processed and added to the queue. You will receive an email as soon as your print is ready for collection. Please contact us with any questions.</p>',
      '<p>View your print overview and status: <span data-email-token="project_link" data-label="View your print"></span></p>'
    ].join('')
  },
  collection_payment_reminder: {
    key: 'collection_payment_reminder',
    subject: 'MISC 3D Printing Collection - Project #{{project_number}}',
    attachQuote: false,
    includeSignature: true,
    htmlBody: [
      '<p>Good day <span data-email-token="student_name"></span>,</p>',
      '<p>Your print is ready for collection.</p>',
      '<p>Please remember to bring a copy of your payment slip or receipt to collect your print.</p>',
      '<p>View your print overview and status: <span data-email-token="project_link" data-label="View your print"></span></p>'
    ].join('')
  },
  collection_ready: {
    key: 'collection_ready',
    subject: 'MISC 3D Printing Collection - Project #{{project_number}}',
    attachQuote: false,
    includeSignature: true,
    htmlBody: [
      '<p>Good day <span data-email-token="student_name"></span>,</p>',
      '<p>Your print is ready for collection.</p>',
      '<p>View your print overview and status: <span data-email-token="project_link" data-label="View your print"></span></p>'
    ].join('')
  }
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const stripTags = (html: string): string => {
  if (typeof document !== 'undefined') {
    const element = document.createElement('div');
    element.innerHTML = html
      .replace(/<a\b([^>]*)href=["']([^"']+)["']([^>]*)>(.*?)<\/a>/gi, (_match: string, _before: string, href: string, _after: string, label: string) => {
        const plainLabel: string = stripTags(label);
        return plainLabel && plainLabel !== href ? `${plainLabel}: ${href}` : href;
      })
      .replace(/<\/p>/gi, '</p>\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/li>/gi, '</li>\n');
    return element.textContent || '';
  }

  return html
    .replace(/<a\b([^>]*)href=["']([^"']+)["']([^>]*)>(.*?)<\/a>/gi, (_match: string, _before: string, href: string, _after: string, label: string) => {
      const plainLabel: string = stripTags(label);
      return plainLabel && plainLabel !== href ? `${plainLabel}: ${href}` : href;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
};

const normalizePlainText = (value: string) =>
  value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isEmailTemplateKey = (value: string): value is EmailTemplateKey =>
  emailTemplateKeys.includes(value as EmailTemplateKey);

const getStudentViewBaseUrl = () => {
  const viteEnv = (import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }).env?.VITE_STUDENT_VIEW_URL;
  const nodeEnv = typeof process !== 'undefined' ? process.env.VITE_STUDENT_VIEW_URL : undefined;
  return viteEnv || nodeEnv || '';
};

const getProjectLinkUrl = (projectId: string) => {
  const baseUrl = getStudentViewBaseUrl().trim().replace(/\/+$/, '');
  const normalizedProjectId = projectId.trim();
  return baseUrl && normalizedProjectId ? `${baseUrl}/${encodeURIComponent(normalizedProjectId)}` : '';
};

const normalizeTemplate = (key: EmailTemplateKey, value: unknown): EmailTemplate => {
  const fallback = defaultEmailTemplates[key];
  if (!isObject(value)) return fallback;

  return {
    key,
    subject: typeof value.subject === 'string' && value.subject.trim() ? value.subject : fallback.subject,
    htmlBody: typeof value.htmlBody === 'string' && value.htmlBody.trim() ? value.htmlBody : fallback.htmlBody,
    attachQuote: typeof value.attachQuote === 'boolean' ? value.attachQuote : fallback.attachQuote,
    includeSignature: typeof value.includeSignature === 'boolean' ? value.includeSignature : fallback.includeSignature
  };
};

export const normalizeEmailTemplates = (value: unknown): EmailTemplates => {
  const source = isObject(value) ? value : {};
  return emailTemplateKeys.reduce((templates, key) => ({
    ...templates,
    [key]: normalizeTemplate(key, source[key])
  }), {} as EmailTemplates);
};

export const normalizeEmailSignature = (value: unknown): EmailSignature => {
  if (!isObject(value)) return defaultEmailSignature;
  return {
    html: typeof value.html === 'string' ? value.html : defaultEmailSignature.html
  };
};

const renderSubject = (subject: string, project: Project) => {
  const projectUrl = getProjectLinkUrl(project.id);
  const withCurlyTokens = subject
    .replace(/\{\{\s*student_name\s*\}\}/gi, escapeHtml(project.studentName))
    .replace(/\{\{\s*project_number\s*\}\}/gi, escapeHtml(String(project.priorityNumber)))
    .replace(/\{\{\s*project_link\s*\}\}/gi, escapeHtml(projectUrl));

  const withChipTokens = withCurlyTokens.replace(
    /<span\b([^>]*)data-email-token=["'](student_name|project_number|project_link)["']([^>]*)>(.*?)<\/span>|<span\b([^>]*)data-email-token=["'](student_name|project_number|project_link)["']([^>]*)\/?>/gi,
    (_match, beforeAttrs = '', tokenA, afterAttrs = '', content = '', beforeSelfAttrs = '', tokenB, afterSelfAttrs = '') => {
      const token = (tokenA || tokenB) as EmailTokenType;
      if (token === 'student_name') return escapeHtml(project.studentName);
      if (token === 'project_number') return escapeHtml(String(project.priorityNumber));

      const attrs = `${beforeAttrs}${afterAttrs}${beforeSelfAttrs}${afterSelfAttrs}`;
      const labelMatch = attrs.match(/data-label=["']([^"']+)["']/i);
      return escapeHtml(labelMatch?.[1] || stripTags(content) || projectUrl);
    }
  );

  return normalizePlainText(stripTags(withChipTokens)).replace(/\s+/g, ' ').trim();
};

const renderHtmlTokens = (html: string, project: Project) => {
  const projectUrl = getProjectLinkUrl(project.id);
  const studentName = escapeHtml(project.studentName);
  const projectNumber = escapeHtml(String(project.priorityNumber));

  return html.replace(
    /<span\b([^>]*)data-email-token=["'](student_name|project_number|project_link)["']([^>]*)>(.*?)<\/span>|<span\b([^>]*)data-email-token=["'](student_name|project_number|project_link)["']([^>]*)\/?>/gi,
    (_match, beforeAttrs = '', tokenA, afterAttrs = '', content = '', beforeSelfAttrs = '', tokenB, afterSelfAttrs = '') => {
      const token = (tokenA || tokenB) as EmailTokenType;
      if (token === 'student_name') return studentName;
      if (token === 'project_number') return projectNumber;

      const attrs = `${beforeAttrs}${afterAttrs}${beforeSelfAttrs}${afterSelfAttrs}`;
      const labelMatch = attrs.match(/data-label=["']([^"']+)["']/i);
      const label = escapeHtml(labelMatch?.[1] || stripTags(content) || 'View your print');
      return projectUrl ? `<a href="${escapeHtml(projectUrl)}">${label}</a>` : label;
    }
  );
};

const appendSignature = (htmlBody: string, signature: EmailSignature) => {
  if (!signature.html.trim()) return htmlBody;
  return `${htmlBody}<div class="email-signature">${signature.html}</div>`;
};

export const renderEmailTemplate = ({
  templates,
  signature,
  templateKey,
  project,
  suppressSignature = false
}: {
  templates: unknown;
  signature: unknown;
  templateKey: EmailTemplateKey;
  project: Project;
  suppressSignature?: boolean;
}): RenderedEmail => {
  const normalizedTemplates = normalizeEmailTemplates(templates);
  const normalizedSignature = normalizeEmailSignature(signature);
  const template = isEmailTemplateKey(templateKey)
    ? normalizedTemplates[templateKey]
    : defaultEmailTemplates.quote_payment_required;

  const htmlWithoutSignature = renderHtmlTokens(template.htmlBody, project);
  const htmlBody = template.includeSignature && !suppressSignature
    ? appendSignature(htmlWithoutSignature, normalizedSignature)
    : htmlWithoutSignature;

  return {
    subject: renderSubject(template.subject, project),
    htmlBody,
    plainBody: normalizePlainText(stripTags(htmlBody)),
    attachQuote: template.attachQuote
  };
};
