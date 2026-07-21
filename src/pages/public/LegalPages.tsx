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
  <ContentPage eyebrow="Internal departmental tool" title="HexForge" updated="21 July 2026">
    <Stack spacing={3}>
      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 760 }}>
        HexForge helps authorized departmental staff manage student 3D printing work from intake through review,
        quoting, production, collection, and student communication.
      </Typography>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip label="Authorized staff only" />
        <Chip label="Google sign-in" />
        <Chip label="Gmail correspondence" />
        <Chip label="Project workflow records" />
      </Stack>

      <Section title="What the app does">
        <ul>
          <li>Records project intake details, print parts, material estimates, payment references, and collection status.</li>
          <li>Uses Google sign-in to identify authorized staff members.</li>
          <li>Creates Gmail drafts for student project updates when a staff member chooses that action.</li>
          <li>Finds recent print-related Gmail conversations and reads the selected thread, including message bodies and attachment details.</li>
          <li>Links one Main Gmail Thread to a project, stores a project correspondence copy, and sends replies only after staff review and confirmation.</li>
          <li>Downloads supported project-file attachments from a linked thread to the staff workstation only when a staff member requests the download.</li>
        </ul>
      </Section>

      <Section title="Google data access">
        <p>
          HexForge uses your Google name, email address, and profile picture to sign you in. With your permission, it can find
          print-related emails, show a conversation you choose, create email drafts, and send a reply after you review and
          confirm it. It can also download a project file when you choose to save it. HexForge cannot delete your Gmail
          messages or change your Gmail labels or settings, and it never sends email automatically.
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

      <Section title="Policies">
        <p>
          Review the <MuiLink component={RouterLink} to="/privacy">Privacy Policy</MuiLink> and{' '}
          <MuiLink component={RouterLink} to="/terms">Terms of Service</MuiLink> before authorizing Google access.
        </p>
      </Section>
    </Stack>
  </ContentPage>
);

export const PrivacyPolicyPage = () => (
  <ContentPage eyebrow="Privacy Policy" title={`${appName} Privacy Policy`} updated="21 July 2026">
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
          <li>Google OAuth credentials: access and refresh tokens used to call Gmail APIs after a signed-in user grants access.</li>
          <li>Gmail correspondence: message and thread IDs, senders, recipients, subjects, dates, plain-text bodies, attachment filenames, and download status for a linked Main Gmail Thread.</li>
          <li>Gmail draft and reply content: recipients, subjects, message bodies, and quote attachments that staff choose to create or send.</li>
          <li>Downloaded Gmail attachments: supported STL, 3MF, and ZIP project files that staff explicitly choose to save to the workstation.</li>
          <li>Project records: student names, student numbers, email addresses, course/module details, lecturer names, print parts, print material details, costs, receipt references, status history, and collection records.</li>
          <li>Staff workflow records: names selected at a workstation for review, printing, and collection actions.</li>
        </ul>
      </Section>

      <Section title="Google Information We Access">
        <ul>
          <li>Your Google name, email address, and profile picture, so HexForge can sign you in and confirm that you are an authorized staff member.</li>
          <li>Recent print-related emails, so you can find and choose the correct student conversation.</li>
          <li>The messages, participants, dates, subject, and attachment details in a conversation you link to a project.</li>
          <li>The contents of a supported attachment only when you choose to download that file.</li>
          <li>The recipient, subject, message, and attachments of a draft or reply you choose to create or send.</li>
        </ul>
        <p>
          In Google's permission system, these features use basic sign-in access together with Gmail read-only and Gmail
          compose access. HexForge cannot delete Gmail messages or change Gmail labels or settings. It does not read or send
          email for advertising or for purposes unrelated to the departmental 3D-printing service.
        </p>
      </Section>

      <Section title="How We Use Information">
        <ul>
          <li>Authenticate staff and restrict access to authorized users.</li>
          <li>Operate the project intake, quote, printing, and collection workflow.</li>
          <li>Create Gmail drafts for student communication when staff explicitly choose that action.</li>
          <li>Show staff recent print-related email threads using Gmail message metadata.</li>
          <li>Display cached Main Gmail Thread correspondence and send staff-reviewed replies through Gmail.</li>
          <li>Maintain operational records needed to run and audit the departmental print service.</li>
        </ul>
      </Section>

      <Section title="Google API Limited Use">
        <p>
          HexForge's use and sharing of information received from Google follows the Google API Services User Data Policy,
          including its Limited Use requirements. Google information is used only for the HexForge features described on this
          page.
        </p>
        <p>
          The app does not sell Google user data; use or transfer it for advertising, retargeting, lending, or determining
          credit-worthiness; transfer it to data brokers or information resellers; or use it to create, train, or improve
          generalized artificial intelligence or machine-learning models.
        </p>
      </Section>

      <Section title="Storage, Processing, and Security">
        <p>
          HexForge stores project records and a copy of each Gmail conversation linked to a project in its protected online
          database. The saved copy includes the people in the conversation, subject, dates, message text, and attachment
          details. This lets authorized staff continue working with the project correspondence in HexForge.
        </p>
        <p>
          HexForge keeps the Google authorization needed to provide these features while your account remains connected. A
          file you choose to download is saved in the relevant project folder on the staff computer. Access is restricted to
          signed-in, authorized staff, and information is sent using encrypted connections. Authorized departmental personnel
          may view linked correspondence when needed to run the service, provide support, investigate a security issue, or
          comply with the law.
        </p>
      </Section>

      <Section title="Sharing and Service Providers">
        <p>
          HexForge does not sell personal information. Google provides the sign-in and Gmail services, and Supabase provides
          the secure sign-in and database services used by HexForge. Information may be seen by authorized university staff
          who need it for the 3D-printing service. It may otherwise be shared only with your permission, for security, when
          required by law, or where the Google API Services User Data Policy allows it. It is not shared for advertising.
        </p>
      </Section>

      <Section title="Retention and Deletion">
        <p>
          A saved Gmail conversation remains linked to its project while it is needed for the work and the department's record
          keeping. Unlinking the conversation deletes the saved messages and attachment details from HexForge. Deleting the
          project also deletes that saved correspondence. A downloaded file is a separate copy and must be deleted from the
          staff computer or departmental file storage separately.
        </p>
        <p>
          Signing out does not delete project records or disconnect HexForge from your Google Account. You can disconnect it
          at any time in your Google Account permissions. You may also ask to see, correct, or delete your information by
          contacting <SupportContactLink />. Some information may have to be kept for university, legal, financial, security,
          or audit reasons. If that happens, access remains restricted and the information is not used for another purpose.
        </p>
      </Section>

      <Section title="Your Choices">
        <ul>
          <li>Do not authorize HexForge if you do not agree to the Google data access described here.</li>
          <li>Revoke HexForge's access at any time from your Google Account permissions.</li>
          <li>Ask the support contact to unlink a Gmail thread or to process an access, correction, or deletion request.</li>
        </ul>
      </Section>

      <Section title="Changes to This Policy">
        <p>
          Material changes to how HexForge accesses or uses Google user data will be published here and, where required,
          presented for renewed consent before the new use begins.
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
  <ContentPage eyebrow="Terms of Service" title={`${appName} Terms of Service`} updated="21 July 2026">
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
          <li>Review recipients, content, and attachments before creating a Gmail draft or confirming a direct reply.</li>
          <li>Do not use the app to access, export, or disclose information outside the approved departmental workflow.</li>
        </ul>
      </Section>

      <Section title="Google Services">
        <p>
          After you give permission, HexForge can sign you in, find print-related emails, display a conversation you choose,
          retrieve a file you choose to download, create drafts, and send replies that you review and confirm. It cannot delete
          your Gmail messages or change your Gmail settings. Google services remain subject to Google's own terms and
          policies, and you can disconnect HexForge in your Google Account permissions at any time.
        </p>
      </Section>

      <Section title="Privacy and Google User Data">
        <p>
          The <MuiLink component={RouterLink} to="/privacy">HexForge Privacy Policy</MuiLink> explains the Google and project
          information the app accesses, why it is needed, where it is stored, who may see it, when it is deleted, and how to
          withdraw permission. Please read it before connecting your Google Account.
        </p>
      </Section>

      <Section title="Acceptable Use">
        <p>
          You must not use HexForge to access mail unrelated to the departmental 3D-printing workflow, send deceptive or
          unlawful messages, bypass access controls, introduce malicious files, or disclose personal information to an
          unauthorized person.
        </p>
      </Section>

      <Section title="Availability and Changes">
        <p>
          HexForge is an internal operational tool provided on an as-available basis. Features may be corrected, changed,
          suspended, or withdrawn for operational, security, legal, or policy reasons. Material changes to the handling of
          Google user data will be addressed as described in the Privacy Policy.
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
