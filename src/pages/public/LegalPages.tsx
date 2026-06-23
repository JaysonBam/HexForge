import {
  Box,
  Button,
  Chip,
  Divider,
  Link as MuiLink,
  Paper,
  Stack,
  Typography
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { quoteContactSettings } from '../../domain/environmentSettings';

const appName = 'HexForge';

const SupportContactLink = () => {
  const supportEmail = quoteContactSettings.supportEmail.trim();

  if (!supportEmail) return <>the configured support contact</>;

  return <MuiLink href={`mailto:${supportEmail}`}>{supportEmail}</MuiLink>;
};

const PageShell = ({ children }: { children: React.ReactNode }) => (
  <Box
    sx={{
      minHeight: '100vh',
      bgcolor: 'background.default',
      color: 'text.primary',
      px: { xs: 2, sm: 4 },
      py: { xs: 3, md: 5 }
    }}
  >
    <Stack spacing={3} sx={{ maxWidth: 980, mx: 'auto' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
      >
        <MuiLink
          component={RouterLink}
          to="/about"
          underline="none"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25, color: 'text.primary' }}
        >
          <Box component="img" src="/favicon.svg" alt="" sx={{ width: 44, height: 44 }} />
          <Typography component="span" sx={{ fontWeight: 900, fontSize: '1.25rem' }}>
            Hex<Box component="span" sx={{ color: 'var(--forge-gold)' }}>Forge</Box>
          </Typography>
        </MuiLink>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button component={RouterLink} to="/about" variant="text">Overview</Button>
          <Button component={RouterLink} to="/privacy" variant="text">Privacy</Button>
          <Button component={RouterLink} to="/terms" variant="text">Terms</Button>
          <Button component={RouterLink} to="/login" variant="contained">Sign in</Button>
        </Stack>
      </Stack>

      {children}
    </Stack>
  </Box>
);

const ContentPage = ({
  eyebrow,
  title,
  updated,
  children
}: {
  eyebrow: string;
  title: string;
  updated?: string;
  children: React.ReactNode;
}) => (
  <PageShell>
    <Paper elevation={0} sx={{ p: { xs: 3, md: 5 }, borderRadius: 1 }}>
      <Stack spacing={3}>
        <Stack spacing={1.25}>
          <Typography sx={{ color: 'primary.main', fontWeight: 900, textTransform: 'uppercase', fontSize: '0.78rem' }}>
            {eyebrow}
          </Typography>
          <Typography component="h1" variant="h3" sx={{ fontWeight: 900, letterSpacing: 0 }}>
            {title}
          </Typography>
          {updated && (
            <Typography color="text.secondary">
              Last updated: {updated}
            </Typography>
          )}
        </Stack>
        <Divider />
        {children}
      </Stack>
    </Paper>
  </PageShell>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Stack component="section" spacing={1.2}>
    <Typography component="h2" variant="h6" sx={{ fontWeight: 900 }}>
      {title}
    </Typography>
    <Box sx={{ color: 'text.secondary', '& p': { mt: 0, mb: 1.2 }, '& li': { mb: 0.8 } }}>
      {children}
    </Box>
  </Stack>
);

export const PublicAppInfoPage = () => (
  <ContentPage eyebrow="Internal departmental tool" title="HexForge 3D Printing Manager">
    <Stack spacing={3}>
      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 760 }}>
        HexForge helps authorized departmental staff manage student 3D printing work from intake through review,
        quoting, production, collection, and student communication.
      </Typography>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip label="Authorized staff only" />
        <Chip label="Google sign-in" />
        <Chip label="Gmail draft support" />
        <Chip label="Project workflow records" />
      </Stack>

      <Section title="What the app does">
        <ul>
          <li>Records project intake details, print parts, material estimates, payment references, and collection status.</li>
          <li>Uses Google sign-in to identify authorized staff members.</li>
          <li>Creates Gmail drafts for student project updates when a staff member chooses that action.</li>
          <li>Checks unread Gmail metadata for print-related messages so staff can notice pending student requests.</li>
        </ul>
      </Section>

      <Section title="Google data access">
        <p>
          The app requests Google profile and email identity data, Gmail draft creation access, and read-only Gmail access
          for print-related reminders. Gmail messages are not sent automatically by HexForge; staff review and send drafts
          from Gmail.
        </p>
      </Section>

      <Section title="Availability">
        <p>
          This application is intended for internal use by authorized staff in the relevant university department. Access is
          controlled by an application allow-list and Google authentication.
        </p>
      </Section>

      <Section title="Support">
        <p>
          For privacy, access, or support requests, contact{' '}
          <SupportContactLink />.
        </p>
      </Section>
    </Stack>
  </ContentPage>
);

export const PrivacyPolicyPage = () => (
  <ContentPage eyebrow="Privacy Policy" title={`${appName} Privacy Policy`} updated="22 June 2026">
    <Stack spacing={3}>
      <Section title="Scope">
        <p>
          This policy explains how HexForge handles personal information and Google user data for the internal 3D printing
          management workflow used by authorized departmental staff.
        </p>
      </Section>

      <Section title="Information We Collect">
        <ul>
          <li>Google account information: email address, display name, and profile image used for sign-in and access control.</li>
          <li>Google OAuth tokens: access and refresh tokens used to call Gmail APIs after a signed-in user grants access.</li>
          <li>Gmail metadata: unread message IDs, subjects, dates, and Gmail links for messages matching print-related search terms.</li>
          <li>Gmail draft content: recipients, subjects, message bodies, and quote attachments that staff choose to create as Gmail drafts.</li>
          <li>Project records: student names, student numbers, email addresses, course/module details, lecturer names, print parts, print material details, costs, receipt references, status history, and collection records.</li>
          <li>Staff workflow records: names selected at a workstation for review, printing, and collection actions.</li>
        </ul>
      </Section>

      <Section title="How We Use Information">
        <ul>
          <li>Authenticate staff and restrict access to authorized users.</li>
          <li>Operate the project intake, quote, printing, and collection workflow.</li>
          <li>Create Gmail drafts for student communication when staff explicitly choose that action.</li>
          <li>Show staff a print-related unread email reminder using Gmail message metadata.</li>
          <li>Maintain operational records needed to run and audit the departmental print service.</li>
        </ul>
      </Section>

      <Section title="Google API Limited Use">
        <p>
          HexForge uses Google user data only to provide or improve user-facing features visible in the app. The app does not
          sell Google user data, use it for advertising, transfer it to advertising platforms or data brokers, or use it to
          determine credit-worthiness.
        </p>
        <p>
          The app does not use Google user data to train generalized artificial intelligence or machine learning models.
        </p>
      </Section>

      <Section title="Storage and Security">
        <p>
          Project and profile records are stored in the configured Supabase project. Google provider tokens are currently held
          in the user browser's local storage and Supabase authentication session so the app can create Gmail drafts and refresh
          Gmail access. Access to operational data is limited to authenticated, authorized staff.
        </p>
      </Section>

      <Section title="Sharing">
        <p>
          HexForge does not sell personal information. Information may be shared only with service providers needed to operate
          the app, with authorized university personnel for the 3D printing workflow, when required by law, or with the user's
          consent.
        </p>
      </Section>

      <Section title="Retention and Deletion">
        <p>
          Operational records are kept for departmental workflow, audit, and service continuity purposes. Users may request
          access, correction, or deletion where applicable by contacting{' '}
          <SupportContactLink />. Some records may be retained where required for
          lawful administrative, financial, security, or audit reasons.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Privacy and support requests can be sent to{' '}
          <SupportContactLink />.
        </p>
      </Section>
    </Stack>
  </ContentPage>
);

export const TermsOfServicePage = () => (
  <ContentPage eyebrow="Terms of Service" title={`${appName} Terms of Service`} updated="22 June 2026">
    <Stack spacing={3}>
      <Section title="Internal Use">
        <p>
          HexForge is provided for authorized internal departmental use. You may use the app only if you are permitted to
          access the department's 3D printing management workflow.
        </p>
      </Section>

      <Section title="User Responsibilities">
        <ul>
          <li>Use your own authorized Google account and do not share access.</li>
          <li>Enter project, student, payment, and collection information accurately.</li>
          <li>Review Gmail drafts before sending them from Gmail.</li>
          <li>Do not use the app to access, export, or disclose information outside the approved departmental workflow.</li>
        </ul>
      </Section>

      <Section title="Google Services">
        <p>
          The app uses Google sign-in and Gmail APIs after you grant access. Google services remain subject to Google's own
          terms and policies. You can revoke the app's Google access from your Google Account permissions.
        </p>
      </Section>

      <Section title="Operational Records">
        <p>
          The app stores workflow records needed to manage student 3D printing requests. These records may be reviewed by
          authorized staff for operational, support, audit, and security purposes.
        </p>
      </Section>

      <Section title="No External Public Service">
        <p>
          HexForge is not offered as a public commercial service and is not intended for use by unaffiliated external users.
          Access may be changed, suspended, or removed if required for security, administration, or policy compliance.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          For access, support, or policy questions, contact{' '}
          <SupportContactLink />.
        </p>
      </Section>
    </Stack>
  </ContentPage>
);
