import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  Alert,
  Button as MuiButton,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Typography
} from '@mui/material';

type FeedbackTone = 'info' | 'success' | 'warning' | 'error';

type FeedbackField = {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'select';
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  options?: string[];
};

type PromptResult = Record<string, string>;

type MessageDialog = {
  kind: 'message';
  title: string;
  message?: string;
  messages?: string[];
  tone?: FeedbackTone;
  resolve: () => void;
};

type ConfirmDialog = {
  kind: 'confirm';
  title: string;
  message?: string;
  messages?: string[];
  tone?: FeedbackTone;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (value: boolean) => void;
};

type PromptDialog = {
  kind: 'prompt';
  title: string;
  message?: string;
  messages?: string[];
  fields: FeedbackField[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: FeedbackTone;
  resolve: (value: PromptResult | null) => void;
};

type ActiveDialog = MessageDialog | ConfirmDialog | PromptDialog;

type NotifyOptions = {
  title?: string;
  message: string;
  tone?: FeedbackTone;
};

type FeedbackContextType = {
  notify: (options: NotifyOptions) => void;
  showMessage: (options: Omit<MessageDialog, 'kind' | 'resolve'>) => Promise<void>;
  confirm: (options: Omit<ConfirmDialog, 'kind' | 'resolve'>) => Promise<boolean>;
  prompt: (options: Omit<PromptDialog, 'kind' | 'resolve'>) => Promise<PromptResult | null>;
};

const FeedbackContext = createContext<FeedbackContextType | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useFeedback = () => {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error('useFeedback must be used within FeedbackProvider');
  }
  return context;
};

export const FeedbackProvider = ({ children }: { children: React.ReactNode }) => {
  const [dialog, setDialog] = useState<ActiveDialog | null>(null);
  const [promptValues, setPromptValues] = useState<PromptResult>({});
  const [promptErrors, setPromptErrors] = useState<Record<string, string>>({});
  const [snackbar, setSnackbar] = useState<NotifyOptions | null>(null);

  const notify = useCallback((options: NotifyOptions) => {
    setSnackbar({ tone: 'info', ...options });
  }, []);

  const showMessage = useCallback((options: Omit<MessageDialog, 'kind' | 'resolve'>) => (
    new Promise<void>((resolve) => {
      setDialog({ kind: 'message', tone: 'info', ...options, resolve });
    })
  ), []);

  const confirm = useCallback((options: Omit<ConfirmDialog, 'kind' | 'resolve'>) => (
    new Promise<boolean>((resolve) => {
      setDialog({ kind: 'confirm', tone: 'warning', ...options, resolve });
    })
  ), []);

  const prompt = useCallback((options: Omit<PromptDialog, 'kind' | 'resolve'>) => (
    new Promise<PromptResult | null>((resolve) => {
      const initialValues = options.fields.reduce((acc, field) => {
        acc[field.name] = field.defaultValue || '';
        return acc;
      }, {} as PromptResult);
      setPromptValues(initialValues);
      setPromptErrors({});
      setDialog({ kind: 'prompt', tone: 'info', ...options, resolve });
    })
  ), []);

  const value = useMemo(() => ({ notify, showMessage, confirm, prompt }), [notify, showMessage, confirm, prompt]);

  const closeDialog = () => {
    if (!dialog) return;
    if (dialog.kind === 'confirm') dialog.resolve(false);
    if (dialog.kind === 'prompt') dialog.resolve(null);
    if (dialog.kind === 'message') dialog.resolve();
    setDialog(null);
  };

  const acceptDialog = () => {
    if (!dialog) return;

    if (dialog.kind === 'message') {
      dialog.resolve();
      setDialog(null);
      return;
    }

    if (dialog.kind === 'confirm') {
      dialog.resolve(true);
      setDialog(null);
      return;
    }

    const errors: Record<string, string> = {};
    dialog.fields.forEach((field) => {
      if (field.required && !promptValues[field.name]?.trim()) {
        errors[field.name] = 'This field is required.';
      }
    });

    if (Object.keys(errors).length > 0) {
      setPromptErrors(errors);
      return;
    }

    dialog.resolve(promptValues);
    setDialog(null);
  };

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      <Dialog
        open={!!dialog}
        onClose={closeDialog}
        fullWidth
        maxWidth={dialog?.kind === 'prompt' ? 'sm' : 'xs'}
        PaperProps={{
          sx: {
            position: 'relative',
            overflow: 'hidden',
            borderRadius: '8px',
            border: '1px solid rgba(203, 213, 225, 0.95)',
            backgroundColor: '#ffffff',
            boxShadow: '0 28px 80px rgba(15, 23, 42, 0.26)'
          }
        }}
      >
        {dialog && (
          <>
            <DialogTitle sx={{ pb: 1 }}>
              <Stack spacing={0.75}>
                <Typography variant="h6" fontWeight={800}>{dialog.title}</Typography>
                {dialog.message && (
                  <Typography variant="body2" color="text.secondary">{dialog.message}</Typography>
                )}
              </Stack>
            </DialogTitle>
            <DialogContent>
              {dialog.messages && dialog.messages.length > 0 && (
                <Alert severity={dialog.tone || 'info'} variant="outlined" sx={{ mt: 1 }}>
                  <Stack component="ul" sx={{ pl: 2, m: 0 }} spacing={0.5}>
                    {dialog.messages.map((item: string) => (
                      <Typography component="li" variant="body2" key={item}>{item}</Typography>
                    ))}
                  </Stack>
                </Alert>
              )}

              {dialog.kind === 'prompt' && (
                <Stack spacing={2} sx={{ mt: 1 }}>
                  {dialog.fields.map((field) => (
                    <TextField
                      key={field.name}
                      select={field.type === 'select'}
                      label={field.label}
                      value={promptValues[field.name] || ''}
                      placeholder={field.placeholder}
                      required={field.required}
                      multiline={field.type === 'textarea'}
                      minRows={field.type === 'textarea' ? 3 : undefined}
                      error={!!promptErrors[field.name]}
                      helperText={promptErrors[field.name] || (field.required ? 'Required' : ' ')}
                      onChange={(event) => {
                        setPromptValues((prev) => ({ ...prev, [field.name]: event.target.value }));
                        setPromptErrors((prev) => ({ ...prev, [field.name]: '' }));
                      }}
                      fullWidth
                      size="small"
                    >
                      {(field.options || []).map((option) => (
                        <MenuItem key={option} value={option}>{option}</MenuItem>
                      ))}
                    </TextField>
                  ))}
                </Stack>
              )}
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              {dialog.kind !== 'message' && (
                <MuiButton onClick={closeDialog} color="inherit">
                  {dialog.kind === 'confirm' ? dialog.cancelLabel || 'Cancel' : dialog.cancelLabel || 'Cancel'}
                </MuiButton>
              )}
              <MuiButton
                onClick={acceptDialog}
                variant="contained"
                color={dialog.kind === 'confirm' && dialog.tone === 'error' ? 'error' : 'primary'}
                sx={{
                  textTransform: 'none',
                  fontWeight: 800,
                  borderRadius: '6px'
                }}
              >
                {dialog.kind === 'message' ? 'OK' : dialog.confirmLabel || 'Continue'}
              </MuiButton>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={4200}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {snackbar ? (
          <Alert
            severity={snackbar.tone || 'info'}
            variant="filled"
            onClose={() => setSnackbar(null)}
            sx={{ alignItems: 'center', boxShadow: '0 16px 48px rgba(15, 23, 42, 0.18)' }}
          >
            {snackbar.title ? <strong>{snackbar.title}: </strong> : null}
            {snackbar.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </FeedbackContext.Provider>
  );
};
