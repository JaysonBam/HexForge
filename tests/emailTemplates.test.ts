import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultEmailSignature,
  defaultEmailTemplates,
  renderEmailTemplate,
  type EmailTemplates
} from '../src/domain/emailTemplates.ts';
import type { Project } from '../src/types/index.ts';

const baseProject: Project = {
  id: 'project-123',
  priorityNumber: 42,
  studentName: 'Ava <Student>',
  studentNumber: '12345678',
  email: 'ava@example.com',
  course: 'MIN 101',
  lecturer: 'Dr Example',
  needsPayment: true,
  moduleOrLecturerPays: false,
  state: 'AWAITING_PAYMENT',
  parts: [],
  createdAt: '2026-06-10T00:00:00.000Z',
  archived: false
};

test('email renderer replaces student and project tokens safely', () => {
  const rendered = renderEmailTemplate({
    templates: defaultEmailTemplates,
    signature: { html: '' },
    templateKey: 'quote_payment_required',
    project: baseProject
  });

  assert.equal(rendered.subject, 'MISC 3D Printing Quote - Project #42');
  assert.match(rendered.htmlBody, /Ava &lt;Student&gt;/);
  assert.match(rendered.plainBody, /Ava <Student>/);
});

test('email renderer turns project link chip into HTML link and plain text label', () => {
  process.env.VITE_STUDENT_VIEW_URL = 'https://misc.example/status';

  const rendered = renderEmailTemplate({
    templates: defaultEmailTemplates,
    signature: { html: '' },
    templateKey: 'collection_ready',
    project: baseProject
  });

  assert.match(rendered.htmlBody, /<a href="https:\/\/misc\.example\/status\/project-123">View your print<\/a>/);
  assert.match(rendered.plainBody, /View your print/);
  assert.match(rendered.plainBody, /https:\/\/misc\.example\/status\/project-123/);
});

test('email renderer supports subject token chips', () => {
  const rendered = renderEmailTemplate({
    templates: {
      ...defaultEmailTemplates,
      collection_ready: {
        ...defaultEmailTemplates.collection_ready,
        subject: '<p>Collection for <span data-email-token="student_name" data-label="Student name"></span> - #<span data-email-token="project_number" data-label="Project #"></span></p>'
      }
    },
    signature: { html: '' },
    templateKey: 'collection_ready',
    project: baseProject
  });

  assert.equal(rendered.subject, 'Collection for Ava <Student> - #42');
});

test('email renderer appends signature only when enabled', () => {
  const templates: EmailTemplates = {
    ...defaultEmailTemplates,
    collection_ready: {
      ...defaultEmailTemplates.collection_ready,
      includeSignature: false
    }
  };

  const withoutSignature = renderEmailTemplate({
    templates,
    signature: { html: '<p>MISC Team</p>' },
    templateKey: 'collection_ready',
    project: baseProject
  });

  const withSignature = renderEmailTemplate({
    templates: defaultEmailTemplates,
    signature: { html: '<p>MISC Team</p>' },
    templateKey: 'collection_ready',
    project: baseProject
  });

  assert.doesNotMatch(withoutSignature.htmlBody, /MISC Team/);
  assert.match(withSignature.htmlBody, /MISC Team/);
});

test('email renderer can suppress signature for communication copy', () => {
  const rendered = renderEmailTemplate({
    templates: defaultEmailTemplates,
    signature: { html: '<p>MISC Team</p>' },
    templateKey: 'collection_ready',
    project: baseProject,
    suppressSignature: true
  });

  assert.doesNotMatch(rendered.htmlBody, /MISC Team/);
  assert.doesNotMatch(rendered.plainBody, /MISC Team/);
});

test('email renderer exposes quote attachment flag', () => {
  const quoteEmail = renderEmailTemplate({
    templates: defaultEmailTemplates,
    signature: defaultEmailSignature,
    templateKey: 'quote_payment_required',
    project: baseProject
  });
  const collectionEmail = renderEmailTemplate({
    templates: defaultEmailTemplates,
    signature: defaultEmailSignature,
    templateKey: 'collection_ready',
    project: baseProject
  });

  assert.equal(quoteEmail.attachQuote, true);
  assert.equal(collectionEmail.attachQuote, false);
});

test('email renderer falls back when stored template data is missing', () => {
  const rendered = renderEmailTemplate({
    templates: null,
    signature: null,
    templateKey: 'quote_payment_required',
    project: baseProject
  });

  assert.equal(rendered.subject, 'MISC 3D Printing Quote - Project #42');
  assert.match(rendered.htmlBody, /quotation is attached/);
});
