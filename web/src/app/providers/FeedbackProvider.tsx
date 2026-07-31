import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

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

const toneClasses: Record<FeedbackTone, string> = {
  info: 'border-sky-300 bg-sky-50 text-sky-950',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-950',
  warning: 'border-amber-300 bg-amber-50 text-amber-950',
  error: 'border-red-300 bg-red-50 text-red-950'
};

// eslint-disable-next-line react-refresh/only-export-components
export const useFeedback = () => {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useFeedback must be used within FeedbackProvider');
  return context;
};

export const FeedbackProvider = ({ children }: { children: React.ReactNode }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [dialog, setDialog] = useState<ActiveDialog | null>(null);
  const [promptValues, setPromptValues] = useState<PromptResult>({});
  const [promptErrors, setPromptErrors] = useState<Record<string, string>>({});
  const [notification, setNotification] = useState<NotifyOptions | null>(null);

  const notify = useCallback((options: NotifyOptions) => {
    setNotification({ tone: 'info', ...options });
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
      setPromptValues(options.fields.reduce((values, field) => ({
        ...values,
        [field.name]: field.defaultValue || ''
      }), {} as PromptResult));
      setPromptErrors({});
      setDialog({ kind: 'prompt', tone: 'info', ...options, resolve });
    })
  ), []);

  useEffect(() => {
    const element = dialogRef.current;
    if (dialog && element && !element.open) element.showModal();
    if (!dialog && element?.open) element.close();
  }, [dialog]);

  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(() => setNotification(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notification]);

  const value = useMemo(
    () => ({ notify, showMessage, confirm, prompt }),
    [notify, showMessage, confirm, prompt]
  );

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
    if (Object.keys(errors).length) {
      setPromptErrors(errors);
      return;
    }

    dialog.resolve(promptValues);
    setDialog(null);
  };

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      <dialog
        ref={dialogRef}
        aria-labelledby="feedback-dialog-title"
        className="m-auto w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-lg border border-slate-300 bg-white p-0 text-slate-950 shadow-2xl backdrop:bg-slate-950/55"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
      >
        {dialog && (
          <div className="p-6">
            <h2 id="feedback-dialog-title" className="text-lg font-extrabold">
              {dialog.title}
            </h2>
            {dialog.message && <p className="mt-2 text-sm text-slate-600">{dialog.message}</p>}

            {dialog.messages?.length ? (
              <ul className={`mt-4 list-disc space-y-1 rounded-md border px-8 py-3 text-sm ${toneClasses[dialog.tone || 'info']}`}>
                {dialog.messages.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : null}

            {dialog.kind === 'prompt' && (
              <div className="mt-5 space-y-4">
                {dialog.fields.map((field) => {
                  const inputClasses = `mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 ${
                    promptErrors[field.name] ? 'border-red-500' : 'border-slate-300'
                  }`;
                  const sharedProps = {
                    id: `feedback-${field.name}`,
                    value: promptValues[field.name] || '',
                    required: field.required,
                    onChange: (
                      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
                    ) => {
                      setPromptValues((previous) => ({
                        ...previous,
                        [field.name]: event.target.value
                      }));
                      setPromptErrors((previous) => ({ ...previous, [field.name]: '' }));
                    }
                  };

                  return (
                    <label key={field.name} className="block text-sm font-bold text-slate-800">
                      {field.label}{field.required ? ' *' : ''}
                      {field.type === 'select' ? (
                        <select {...sharedProps} className={inputClasses}>
                          <option value="">Select an option</option>
                          {(field.options || []).map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      ) : field.type === 'textarea' ? (
                        <textarea {...sharedProps} className={inputClasses} rows={3} placeholder={field.placeholder} />
                      ) : (
                        <input {...sharedProps} className={inputClasses} type="text" placeholder={field.placeholder} />
                      )}
                      <span className={`mt-1 block min-h-4 text-xs ${promptErrors[field.name] ? 'text-red-700' : 'text-slate-500'}`}>
                        {promptErrors[field.name] || (field.required ? 'Required' : '')}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              {dialog.kind !== 'message' && (
                <button
                  type="button"
                  className="rounded-md px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                  onClick={closeDialog}
                >
                  {dialog.cancelLabel || 'Cancel'}
                </button>
              )}
              <button
                type="button"
                className={`rounded-md px-4 py-2 text-sm font-extrabold text-white focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  dialog.kind === 'confirm' && dialog.tone === 'error'
                    ? 'bg-red-700 hover:bg-red-800 focus-visible:outline-red-700'
                    : 'bg-sky-700 hover:bg-sky-800 focus-visible:outline-sky-700'
                }`}
                onClick={acceptDialog}
              >
                {dialog.kind === 'message' ? 'OK' : dialog.confirmLabel || 'Continue'}
              </button>
            </div>
          </div>
        )}
      </dialog>

      {notification && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 right-5 z-50 max-w-sm rounded-lg border px-4 py-3 text-sm shadow-xl ${toneClasses[notification.tone || 'info']}`}
        >
          <div className="flex items-start gap-3">
            <p>
              {notification.title ? <strong>{notification.title}: </strong> : null}
              {notification.message}
            </p>
            <button
              type="button"
              aria-label="Dismiss notification"
              className="rounded px-1 font-black hover:bg-black/10 focus-visible:outline-2"
              onClick={() => setNotification(null)}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
};
