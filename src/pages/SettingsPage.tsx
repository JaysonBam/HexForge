import { useMemo, useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import { Button } from '../components/ui/Button';
import { useFeedback } from '../components/ui/FeedbackProvider';
import type { EmailEditorSelection } from '../domain/emailTemplates';
import {
    DEFAULT_FILAMENT_SOURCE,
    FILAMENT_SOURCE_VALUES,
    filamentSourceLabel,
    normalizeFilamentSource,
    type FilamentSource
} from '../domain/filamentSource.ts';
import {
    EmailMessagesEditor,
    FilamentPriceGroupRow,
    ModuleRow,
    SettingsPageSkeleton,
    SettingsSection,
    TextListEditor,
    type TextListConfig,
    type TextListKey
} from './settings/SettingsComponents';
import { groupFilamentsByPrice, type Filament } from '../domain/settingsConfig';
import {
    Plus
} from 'lucide-react';

export const SettingsPage = () => {
    const {
        settingsLoading, settingsLoadError,
        nextPriority, setNextPriority,
        staffList, addStaff, removeStaff,
        printers, addPrinter, removePrinter,
        brands, addBrand, removeBrand,
        modules, addModule, removeModule, updateModule,
        filaments, addFilament, removeFilament, updateFilament,
        providedFilamentPricePerGram, setProvidedFilamentPricePerGram,
        emailTemplates, updateEmailTemplate,
        emailSignature, updateEmailSignature,
        emailSettingsSaving, emailSettingsSaveError, saveEmailSettings
    } = useSettings();
    const { confirm, notify } = useFeedback();

    const [newItems, setNewItems] = useState<Record<TextListKey, string>>({
        staff: '',
        printer: '',
        brand: ''
    });
    const [newModule, setNewModule] = useState({
        code: '',
        lecturer: '',
        modulePayment: false,
        defaultFilamentSource: DEFAULT_FILAMENT_SOURCE as FilamentSource
    });
    const [newFilament, setNewFilament] = useState({ type: '', price: '' });
    const [emailSelection, setEmailSelection] = useState<EmailEditorSelection>('quote_payment_required');
    const [emailSettingsDirty, setEmailSettingsDirty] = useState(false);
    const filamentPriceGroups = useMemo(() => groupFilamentsByPrice(filaments), [filaments]);

    const textLists = useMemo<TextListConfig[]>(() => [
        {
            key: 'staff',
            title: 'Staff',
            description: 'Names used for checks, printing, and collections.',
            placeholder: 'Add staff member',
            items: staffList,
            add: addStaff,
            remove: removeStaff
        },
        {
            key: 'printer',
            title: 'Printers',
            description: 'Hardware choices available during printing.',
            placeholder: 'Add printer',
            items: printers,
            add: addPrinter,
            remove: removePrinter
        },
        {
            key: 'brand',
            title: 'Brands',
            description: 'Common brand suggestions for project intake.',
            placeholder: 'Add brand',
            items: brands,
            add: addBrand,
            remove: removeBrand
        }
    ], [addBrand, addPrinter, addStaff, brands, printers, removeBrand, removePrinter, removeStaff, staffList]);

    const totals = [
        { label: 'Staff', value: staffList.length },
        { label: 'Printers', value: printers.length },
        { label: 'Modules', value: modules.length },
        { label: 'Filaments', value: filaments.length }
    ];

    if (settingsLoading) {
        return <SettingsPageSkeleton />;
    }

    const confirmRemove = async (label: string, remove: () => void) => {
        const ok = await confirm({
            title: 'Remove suggestion',
            message: `Remove ${label} from future suggestions? Historical project text will remain unchanged.`,
            confirmLabel: 'Remove',
            tone: 'warning'
        });
        if (ok) remove();
    };

    const addTextItem = (config: TextListConfig) => {
        const value = newItems[config.key].trim();
        if (!value) return;

        config.add(value);
        setNewItems((prev) => ({ ...prev, [config.key]: '' }));
    };

    const handleAddModule = () => {
        const code = newModule.code.trim();
        const lecturer = newModule.lecturer.trim();
        if (!code || !lecturer) return;

        addModule(code, lecturer, newModule.modulePayment, newModule.defaultFilamentSource);
        setNewModule({
            code: '',
            lecturer: '',
            modulePayment: false,
            defaultFilamentSource: DEFAULT_FILAMENT_SOURCE
        });
    };

    const handleAddFilament = () => {
        const type = newFilament.type.trim();
        const price = Number.parseFloat(newFilament.price);
        if (!type || !Number.isFinite(price)) return;

        addFilament({ type, pricePerGram: price });
        setNewFilament({ type: '', price: '' });
    };

    const handleUpdateFilamentGroupPrice = (groupFilaments: Filament[], pricePerGram: number) => {
        groupFilaments.forEach((filament) => updateFilament(filament.id, { pricePerGram }));
    };

    const handleUpdateEmailTemplate: typeof updateEmailTemplate = (key, updates) => {
        setEmailSettingsDirty(true);
        updateEmailTemplate(key, updates);
    };

    const handleUpdateEmailSignature: typeof updateEmailSignature = (updates) => {
        setEmailSettingsDirty(true);
        updateEmailSignature(updates);
    };

    const handleSaveEmailSettings = async () => {
        const ok = await saveEmailSettings();
        if (!ok) return;
        setEmailSettingsDirty(false);
        notify({ message: 'Email messages saved.', tone: 'success' });
    };

    return (
        <div className="flex w-full flex-col gap-5">
            <section className="forge-panel p-4">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
                    <div className="min-w-0">
                        <div className="text-sm font-black uppercase tracking-[0.12em] text-sky-700">
                            System Settings
                        </div>
                        <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">
                            Manage the defaults behavior.
                        </h1>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        {totals.map((item) => (
                            <div key={item.label} className="forge-metric min-w-[8rem] px-3 py-2">
                                <div className="text-2xl font-black leading-none text-slate-950">{item.value}</div>
                                <div className="mt-1 text-[0.65rem] font-black uppercase tracking-[0.14em] text-slate-600">{item.label}</div>
                            </div>
                        ))}
                    </div>
                </div>

                {settingsLoadError && (
                    <div className="mt-4 rounded-lg border border-rose-300 bg-rose-100 px-4 py-3 text-sm font-bold text-rose-900">
                        {settingsLoadError}
                    </div>
                )}
            </section>

            <div className="min-w-0 space-y-5">
                    <SettingsSection
                        id="project-defaults"
                        title="Project Defaults"
                        description="Small operational values that affect new projects immediately."
                    >
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_14rem] lg:items-center">
                            <div>
                                <h3 className="font-bold text-slate-950">Next priority number</h3>
                                <p className="mt-1 text-sm text-slate-600">
                                    The number assigned to the next project created from the workstation.
                                </p>
                            </div>
                            <input
                                type="number"
                                min={1}
                                className="forge-command-input h-11 w-full px-3 text-right font-mono text-lg font-bold"
                                value={nextPriority}
                                onChange={(event) => setNextPriority(Number.parseInt(event.target.value, 10) || 1)}
                            />
                        </div>
                    </SettingsSection>

                    <SettingsSection
                        id="quick-lists"
                        title="Suggestion Lists"
                        description="Compact lists for the dropdowns and autocomplete fields used across project workflows."
                    >
                        <div className="grid gap-4 lg:grid-cols-3">
                            {textLists.map((config) => (
                                <TextListEditor
                                    key={config.key}
                                    config={config}
                                    value={newItems[config.key]}
                                    onValueChange={(value) => setNewItems((prev) => ({ ...prev, [config.key]: value }))}
                                    onAdd={() => addTextItem(config)}
                                    onRemove={(item) => confirmRemove(item, () => config.remove(item))}
                                />
                            ))}
                        </div>
                    </SettingsSection>

                    <SettingsSection
                        id="modules"
                        title="Modules"
                        description="Course codes, lecturers, payment routing, and the filament source applied to new parts for that module."
                    >
                        <div className="forge-panel-muted grid gap-2 p-3 lg:grid-cols-[9rem_minmax(10rem,1fr)_9rem_minmax(12rem,0.8fr)_auto]">
                            <input
                                className="forge-command-input h-10 px-3 text-sm font-semibold"
                                placeholder="Code"
                                value={newModule.code}
                                onChange={(event) => setNewModule((prev) => ({ ...prev, code: event.target.value }))}
                            />
                            <input
                                className="forge-command-input h-10 px-3 text-sm font-semibold"
                                placeholder="Lecturer"
                                value={newModule.lecturer}
                                onChange={(event) => setNewModule((prev) => ({ ...prev, lecturer: event.target.value }))}
                            />
                            <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-[color:var(--forge-gold-border)] bg-white px-3 text-xs font-bold text-slate-800 shadow-sm">
                                <input
                                    type="checkbox"
                                    checked={newModule.modulePayment}
                                    onChange={(event) => setNewModule((prev) => ({ ...prev, modulePayment: event.target.checked }))}
                                    className="rounded text-slate-950"
                                />
                                Mod pays
                            </label>
                            <select
                                className="forge-command-input h-10 px-3 text-sm font-semibold"
                                value={newModule.defaultFilamentSource}
                                onChange={(event) => setNewModule((prev) => ({
                                    ...prev,
                                    defaultFilamentSource: normalizeFilamentSource(event.target.value)
                                }))}
                            >
                                {FILAMENT_SOURCE_VALUES.map((source) => (
                                    <option key={source} value={source}>{filamentSourceLabel(source)}</option>
                                ))}
                            </select>
                            <Button onClick={handleAddModule} size="sm" className="h-10 gap-2">
                                <Plus size={15} /> Add
                            </Button>
                        </div>

                        <div className="mt-4 max-h-[22rem] overflow-auto rounded-lg border border-[color:var(--ui-border)]">
                            <table className="w-full min-w-[42rem] text-left text-sm">
                                <thead className="forge-table-head sticky top-0 z-10 border-b border-[color:var(--ui-border)] text-[0.68rem] font-black uppercase tracking-[0.12em]">
                                    <tr>
                                        <th className="px-4 py-3">Code</th>
                                        <th className="px-4 py-3">Lecturer</th>
                                        <th className="px-4 py-3">Pays</th>
                                        <th className="px-4 py-3">Default filament</th>
                                        <th className="px-4 py-3 text-right">Remove</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-300 bg-white">
                                    {modules.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-8 text-center text-sm font-semibold text-slate-600">
                                                No modules configured yet.
                                            </td>
                                        </tr>
                                    ) : modules.map((module) => (
                                        <ModuleRow
                                            key={module.id}
                                            module={module}
                                            onUpdate={updateModule}
                                            onRemove={() => confirmRemove(module.code, () => removeModule(module.id))}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </SettingsSection>

                    <SettingsSection
                        id="filaments"
                        title="Filament Pricing"
                        description="Materials with the same R/gram are grouped together."
                    >
                        <div className="forge-panel-muted mb-4 grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_12rem] lg:items-center">
                            <div>
                                <h3 className="font-black text-slate-950">Provided filament service</h3>
                                <p className="mt-1 text-sm font-semibold text-slate-600">
                                    Price per gram when a student or module brings compatible filament.
                                </p>
                            </div>
                            <input
                                className="forge-command-input h-10 w-full px-3 text-right font-mono text-sm font-semibold"
                                type="number"
                                step="0.01"
                                min={0}
                                value={providedFilamentPricePerGram}
                                onChange={(event) => setProvidedFilamentPricePerGram(Number.parseFloat(event.target.value) || 0)}
                                aria-label="Provided filament price per gram"
                            />
                        </div>

                        <div className="forge-panel-muted grid gap-2 p-3 lg:grid-cols-[minmax(12rem,1fr)_12rem_auto]">
                            <input
                                className="forge-command-input h-10 px-3 text-sm font-semibold"
                                placeholder="Material type"
                                value={newFilament.type}
                                onChange={(event) => setNewFilament((prev) => ({ ...prev, type: event.target.value }))}
                            />
                            <input
                                className="forge-command-input h-10 px-3 text-right font-mono text-sm font-semibold"
                                placeholder="R / gram"
                                type="number"
                                step="0.01"
                                min={0}
                                value={newFilament.price}
                                onChange={(event) => setNewFilament((prev) => ({ ...prev, price: event.target.value }))}
                            />
                            <Button onClick={handleAddFilament} size="sm" className="h-10 gap-2">
                                <Plus size={15} /> Add
                            </Button>
                        </div>

                        <div className="mt-4 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                            {filamentPriceGroups.length === 0 ? (
                                <div className="forge-empty px-4 py-8 text-center text-sm font-semibold sm:col-span-2 2xl:col-span-3">
                                    No filament prices configured yet.
                                </div>
                            ) : filamentPriceGroups.map((group) => (
                                <FilamentPriceGroupRow
                                    key={group.pricePerGram}
                                    group={group}
                                    onUpdatePrice={handleUpdateFilamentGroupPrice}
                                    onRemove={(filament) => confirmRemove(filament.type, () => removeFilament(filament.id))}
                                />
                            ))}
                        </div>
                    </SettingsSection>

                    <SettingsSection
                        id="email-messages"
                        title="Email Messages"
                        description="Rich email templates used when staff open Gmail drafts from project checkpoints."
                    >
                        <EmailMessagesEditor
                            selection={emailSelection}
                            onSelectionChange={setEmailSelection}
                            emailTemplates={emailTemplates}
                            updateEmailTemplate={handleUpdateEmailTemplate}
                            emailSignature={emailSignature}
                            updateEmailSignature={handleUpdateEmailSignature}
                            emailSettingsDirty={emailSettingsDirty}
                            emailSettingsSaving={emailSettingsSaving}
                            emailSettingsSaveError={emailSettingsSaveError}
                            onSave={handleSaveEmailSettings}
                        />
                    </SettingsSection>

            </div>
        </div>
    );
};
