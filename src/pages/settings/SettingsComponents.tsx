import type { ReactNode } from 'react';
import { Paperclip, Plus, Save, Trash2 } from 'lucide-react';
import { RichEmailEditor, TokenSubjectEditor } from '../../components/settings/RichEmailEditor';
import { Button } from '../../components/ui/Button';
import {
  emailTemplateKeys,
  emailTemplateLabels,
  type EmailEditorSelection
} from '../../domain/emailTemplates';
import {
  FILAMENT_SOURCE_VALUES,
  filamentSourceLabel,
  normalizeFilamentSource
} from '../../domain/filamentSource.ts';
import type { Filament, Module, useSettings } from '../../context/SettingsContext';
import type { FilamentPriceGroup } from '../../domain/settingsConfig';

export type TextListKey = 'staff' | 'printer' | 'brand';

export type TextListConfig = {
  key: TextListKey;
  title: string;
  description: string;
  placeholder: string;
  items: string[];
  add: (value: string) => void;
  remove: (value: string) => void;
};

export const SettingsSection = ({
  id,
  title,
  description,
  children
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) => (
  <section id={id} className="forge-panel scroll-mt-6 p-4">
    <div className="mb-4 flex flex-col gap-3 border-b border-slate-300 pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-lg font-black text-slate-950">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>
      </div>
    </div>
    {children}
  </section>
);

export const TextListEditor = ({
  config,
  value,
  onValueChange,
  onAdd,
  onRemove
}: {
  config: TextListConfig;
  value: string;
  onValueChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (item: string) => void;
}) => (
  <div className="forge-panel-muted flex min-h-[20rem] flex-col">
    <div className="border-b border-slate-300 p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="min-w-0 truncate font-black text-slate-950">{config.title}</h3>
        <span className="forge-pill px-2 py-0.5 text-xs text-slate-700">
          {config.items.length}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-600">{config.description}</p>
    </div>

    <div className="flex gap-2 p-3">
      <input
        className="forge-command-input h-9 min-w-0 flex-1 px-3 text-sm font-semibold"
        placeholder={config.placeholder}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && value.trim()) onAdd();
        }}
      />
      <Button onClick={onAdd} size="icon" className="h-9 w-9" disabled={!value.trim()} title={!value.trim() ? 'Enter a value first.' : undefined}>
        <Plus size={15} />
      </Button>
    </div>

    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      {config.items.length === 0 ? (
        <div className="forge-empty px-3 py-6 text-center text-sm font-semibold">
          Nothing added yet.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {config.items.map((item) => (
            <li key={item} className="forge-panel flex items-center justify-between gap-2 px-3 py-2 text-sm font-bold text-slate-900">
              <span className="min-w-0 truncate">{item}</span>
              <button
                onClick={() => onRemove(item)}
                className="rounded border border-transparent p-1 text-slate-600 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800"
                aria-label={`Remove ${item}`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  </div>
);

export const ModuleRow = ({
  module,
  onUpdate,
  onRemove
}: {
  module: Module;
  onUpdate: (id: string, updates: Partial<Module>) => void;
  onRemove: () => void;
}) => (
  <tr className="transition hover:bg-slate-50">
    <td className="px-4 py-3 font-black text-slate-950">{module.code}</td>
    <td className="px-4 py-3 font-medium text-slate-700">{module.lecturer}</td>
    <td className="px-4 py-3">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[color:var(--ui-border)] bg-white px-2.5 py-1 text-xs font-bold text-slate-800 shadow-sm">
        <input
          type="checkbox"
          checked={module.modulePayment || false}
          onChange={(event) => onUpdate(module.id, { modulePayment: event.target.checked })}
          className="rounded text-sky-700"
        />
        {module.modulePayment ? 'Module' : 'Student'}
      </label>
    </td>
    <td className="px-4 py-3">
      <select
        className="forge-command-input h-9 w-full min-w-[12rem] px-2 text-xs font-bold"
        value={normalizeFilamentSource(module.defaultFilamentSource)}
        onChange={(event) => onUpdate(module.id, {
          defaultFilamentSource: normalizeFilamentSource(event.target.value)
        })}
        aria-label={`${module.code} default filament source`}
      >
        {FILAMENT_SOURCE_VALUES.map((source) => (
          <option key={source} value={source}>{filamentSourceLabel(source)}</option>
        ))}
      </select>
    </td>
    <td className="px-4 py-3 text-right">
      <button
        onClick={onRemove}
        className="rounded-md border border-[color:var(--ui-border)] bg-white p-1.5 text-slate-600 shadow-sm transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800"
        aria-label={`Remove ${module.code}`}
      >
        <Trash2 size={14} />
      </button>
    </td>
  </tr>
);

export const FilamentPriceGroupRow = ({
  group,
  onUpdatePrice,
  onRemove
}: {
  group: FilamentPriceGroup;
  onUpdatePrice: (filaments: Filament[], pricePerGram: number) => void;
  onRemove: (filament: Filament) => void;
}) => (
  <div className="forge-panel grid gap-3 p-3">
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-center">
      <div className="min-w-0">
        <div className="font-black text-slate-950">
          {group.filaments.length} {group.filaments.length === 1 ? 'material' : 'materials'}
        </div>
        <div className="mt-0.5 text-xs font-semibold text-slate-600">Shared price per gram</div>
      </div>
      <input
        type="number"
        step="0.01"
        min={0}
        className="forge-command-input h-9 w-full px-2 text-right font-mono text-sm font-bold"
        value={group.pricePerGram}
        onChange={(event) => onUpdatePrice(group.filaments, Number.parseFloat(event.target.value) || 0)}
        aria-label={`Price per gram for ${group.filaments.map((filament) => filament.type).join(', ')}`}
      />
    </div>

    <div className="flex flex-wrap gap-2">
      {group.filaments.map((filament) => (
        <div key={filament.id} className="inline-flex max-w-full items-center gap-2 rounded-md border border-[color:var(--ui-border)] bg-white px-2.5 py-1.5 text-sm font-bold text-slate-900 shadow-sm">
          <span className="min-w-0 truncate">{filament.type}</span>
          <button
            onClick={() => onRemove(filament)}
            className="rounded border border-transparent p-0.5 text-slate-500 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800"
            aria-label={`Remove ${filament.type}`}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  </div>
);

export const EmailMessagesEditor = ({
  selection,
  onSelectionChange,
  emailTemplates,
  updateEmailTemplate,
  emailSignature,
  updateEmailSignature,
  emailSettingsDirty,
  emailSettingsSaving,
  emailSettingsSaveError,
  onSave
}: {
  selection: EmailEditorSelection;
  onSelectionChange: (selection: EmailEditorSelection) => void;
  emailTemplates: ReturnType<typeof useSettings>['emailTemplates'];
  updateEmailTemplate: ReturnType<typeof useSettings>['updateEmailTemplate'];
  emailSignature: ReturnType<typeof useSettings>['emailSignature'];
  updateEmailSignature: ReturnType<typeof useSettings>['updateEmailSignature'];
  emailSettingsDirty: boolean;
  emailSettingsSaving: boolean;
  emailSettingsSaveError: string | null;
  onSave: () => void;
}) => {
  const isSignature = selection === 'signature';
  const selectedTemplate = isSignature ? null : emailTemplates[selection];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(14rem,22rem)_minmax(0,1fr)] lg:items-end">
        <label className="block">
          <span className="mb-1 block text-xs font-black uppercase tracking-[0.12em] text-slate-600">Edit</span>
          <select
            value={selection}
            onChange={(event) => onSelectionChange(event.target.value as EmailEditorSelection)}
            className="forge-command-input h-10 w-full px-3 text-sm font-bold"
          >
            {emailTemplateKeys.map((key) => (
              <option key={key} value={key}>{emailTemplateLabels[key]}</option>
            ))}
            <option value="signature">{emailTemplateLabels.signature}</option>
          </select>
        </label>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          {selectedTemplate && (
            <>
              <button
                type="button"
                onClick={() => updateEmailTemplate(selectedTemplate.key, { attachQuote: !selectedTemplate.attachQuote })}
                className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-black transition ${
                  selectedTemplate.attachQuote
                    ? 'border-emerald-300 bg-emerald-100 text-emerald-900 shadow-sm'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-sky-50'
                }`}
              >
                <Paperclip size={16} />
                {selectedTemplate.attachQuote ? 'Quote attached' : 'No quote attachment'}
              </button>
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-[color:var(--forge-gold-border)] bg-white px-4 text-sm font-bold text-slate-800 shadow-sm">
                <input
                  type="checkbox"
                  checked={selectedTemplate.includeSignature}
                  onChange={(event) => updateEmailTemplate(selectedTemplate.key, { includeSignature: event.target.checked })}
                  className="rounded text-slate-950"
                />
                Include signature
              </label>
            </>
          )}
          <Button
            type="button"
            onClick={onSave}
            size="sm"
            disabled={emailSettingsSaving || !emailSettingsDirty}
            loading={emailSettingsSaving}
            loadingText="Saving…"
            className="h-10 gap-2 px-4"
          >
            <Save size={15} />
            {emailSettingsDirty ? 'Save' : 'Saved'}
          </Button>
        </div>
      </div>

      {(emailSettingsDirty || emailSettingsSaveError) && (
        <div className={`rounded-md border px-3 py-2 text-sm font-semibold ${
          emailSettingsSaveError
            ? 'border-rose-300 bg-rose-50 text-rose-900'
            : 'border-amber-300 bg-amber-50 text-amber-900'
        }`}>
          {emailSettingsSaveError || 'You have unsaved email message changes. Click Save before closing the app or sending test drafts.'}
        </div>
      )}

      {selectedTemplate ? (
        <div className="space-y-4">
          <div className="forge-panel-muted p-3">
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-slate-800">Subject</span>
              <TokenSubjectEditor
                value={selectedTemplate.subject}
                onChange={(subject) => updateEmailTemplate(selectedTemplate.key, { subject })}
              />
            </label>
          </div>

          <RichEmailEditor
            value={selectedTemplate.htmlBody}
            onChange={(htmlBody) => updateEmailTemplate(selectedTemplate.key, { htmlBody })}
            allowTokens
          />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-950">
            This signature is appended to templates where "Include signature" is enabled. Images uploaded here are saved to the public-read email assets bucket so Gmail recipients can see them.
          </div>
          <RichEmailEditor
            value={emailSignature.html}
            onChange={(html) => updateEmailSignature({ html })}
            allowImages
          />
        </div>
      )}
    </div>
  );
};

const SkeletonBar = ({ className = '' }: { className?: string }) => (
  <div className={`forge-skeleton rounded ${className}`} />
);

export const SettingsPageSkeleton = () => (
  <div className="flex w-full flex-col gap-5">
    <section className="forge-panel p-4">
      <SkeletonBar className="h-4 w-40" />
      <SkeletonBar className="mt-3 h-8 w-full max-w-2xl" />
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonBar key={index} className="h-16" />
        ))}
      </div>
    </section>

    <div className="space-y-5">
      {Array.from({ length: 4 }).map((_, index) => (
        <section key={index} className="forge-panel p-4">
          <div className="mb-4 border-b border-slate-300 pb-4">
            <div className="flex-1">
              <SkeletonBar className="h-5 w-40" />
              <SkeletonBar className="mt-2 h-4 w-full max-w-xl" />
            </div>
          </div>
          <SkeletonBar className="h-28 w-full" />
        </section>
      ))}
    </div>
  </div>
);
