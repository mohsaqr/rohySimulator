import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Search, Plus, Loader2, Edit2, Save, X, RefreshCw, Lock, Stethoscope,
    Pill, Droplets, Wind, HeartPulse, Ban, RotateCcw, ExternalLink, Globe, Check
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { ApiError, apiDelete, apiFetch, apiPost, apiPut } from '../../services/apiClient';

// Settings → Libraries → Treatments: the editable `treatment_effects`
// catalogue students order from (student TreatmentPanel via
// /sessions/:id/available-treatments; case editor via CaseTreatmentConfig).
//
// Scope model (migration 0046, server/routes/treatments-library-routes.js):
//   platform — every tenant sees it; admins edit.
//   tenant   — only this tenant sees it; educator+ of the tenant edit.
// The role table and canEditRow() mirror canMutateTreatment() server-side so
// the Edit affordance only shows where a click will actually succeed.

const ROLE_RANKS = { guest: 0, student: 1, user: 1, reviewer: 2, educator: 3, admin: 4 };
const rankOf = (user) => ROLE_RANKS[user?.role] ?? 0;

// Platform rows belong to the install: only an administrator of the platform
// tenant (tenant 1) may change them — server isPlatformAdmin (routes/_helpers.js).
// A tenant admin used to be offered Edit and then refused with a 403
// (lane B, security audit 2026-10-26, F-02).
const PLATFORM_TENANT_ID = 1;
const isPlatformAdminUser = (user) =>
    rankOf(user) >= ROLE_RANKS.admin && Number(user?.tenant_id ?? PLATFORM_TENANT_ID) === PLATFORM_TENANT_ID;

export function canEditRow(user, row) {
    if (!user || !row) return false;
    if (row.scope === 'platform') return isPlatformAdminUser(user);
    if (row.scope === 'tenant') {
        return row.tenant_id === (user.tenant_id ?? 1) && rankOf(user) >= ROLE_RANKS.educator;
    }
    return false;
}

export const TREATMENT_TYPES = ['medication', 'iv_fluid', 'oxygen', 'nursing'];

// Type labels are the ones CaseTreatmentConfig already ships (authoring_case
// namespace) — one translation, two surfaces. Static key map so the parser
// can't be fooled by a dynamic key.
const TYPE_META = {
    medication: { labelKey: 'category_medications', icon: Pill, badge: 'rohy-badge-violet' },
    iv_fluid:   { labelKey: 'category_iv_fluids',   icon: Droplets, badge: 'rohy-badge-blue' },
    oxygen:     { labelKey: 'category_oxygen',      icon: Wind, badge: 'rohy-badge-cyan' },
    nursing:    { labelKey: 'category_nursing',     icon: HeartPulse, badge: 'rohy-badge-green' },
};

// Common route values in the seeded catalogue; the field stays free text.
const ROUTE_SUGGESTIONS = ['IV', 'oral', 'IM', 'SC', 'inhaled', 'sublingual', 'nebulized', 'topical', 'position'];

const EFFECT_FIELDS = [
    ['hr_effect', 'tl_field_hr_effect', 'bpm'],
    ['bp_sys_effect', 'tl_field_bp_sys_effect', 'mmHg'],
    ['bp_dia_effect', 'tl_field_bp_dia_effect', 'mmHg'],
    ['rr_effect', 'tl_field_rr_effect', '/min'],
    ['spo2_effect', 'tl_field_spo2_effect', '%'],
    ['temp_effect', 'tl_field_temp_effect', '°C'],
    ['etco2_effect', 'tl_field_etco2_effect', 'mmHg'],
];

const EMPTY_DRAFT = {
    treatment_type: 'medication',
    treatment_name: '',
    route: 'IV',
    onset_minutes: 5,
    peak_minutes: 15,
    duration_minutes: 60,
    hr_effect: 0,
    bp_sys_effect: 0,
    bp_dia_effect: 0,
    rr_effect: 0,
    spo2_effect: 0,
    temp_effect: 0,
    etco2_effect: 0,
    dose_dependent: false,
    base_dose: '',
    base_dose_unit: '',
    max_effect_multiplier: 2,
    description: '',
    rxcui: '',
    pk_source: '',
    pk_evidence_url: '',
    scope: 'platform',
};

// Status segment (Active | Deactivated | All). Default Active — the
// deactivated rows live in their own view with a Restore action instead of
// being mixed into the active list, which read as "the toggle does nothing".
export const STATUS_VIEWS = ['active', 'inactive', 'all'];
const STATUS_LABEL_KEYS = { active: 'tl_status_active', inactive: 'tl_status_deactivated', all: 'tl_status_all' };
const statusMatches = (view, row) => view === 'all' || (view === 'active' ? !!row.is_active : !row.is_active);

// RxNorm term types → the three buckets the search list labels. Static key
// map (parser-visible); unknown / missing tty renders the raw code.
const TTY_GROUPS = {
    ingredient: { ttys: ['IN', 'MIN', 'PIN'], labelKey: 'tl_tty_ingredient' },
    clinical:   { ttys: ['SCD', 'SCDF', 'SCDG', 'GPCK'], labelKey: 'tl_tty_clinical' },
    brand:      { ttys: ['SBD', 'SBDF', 'SBDG', 'BPCK', 'BN'], labelKey: 'tl_tty_brand' },
};
export function ttyGroup(tty) {
    const code = String(tty || '').toUpperCase();
    return Object.keys(TTY_GROUPS).find((g) => TTY_GROUPS[g].ttys.includes(code)) || null;
}

// Route guess from an RxNorm dose-form name ("ceftriaxone 1000 MG Injection"
// → IV). Only the unambiguous forms; anything else stays blank for the
// educator to fill in.
export function guessRouteFromName(name) {
    const n = String(name || '').toLowerCase();
    if (/\binject(?:ion|able)\b/.test(n)) return 'IV';
    if (/\boral (?:tablet|capsule|solution|suspension)\b/.test(n) || /\bcapsule\b/.test(n)) return 'oral';
    if (/\binhal(?:ant|ation)\b/.test(n)) return 'inhaled';
    return '';
}

// The editor draft for a search hit: name + rxcui + route guess, everything
// else at the zero-effect defaults (orderable + scored, no vitals change).
export function prefillFromHit(hit) {
    const name = hit.external_source === 'openfda'
        ? (hit.generic_name || hit.display_name || '')
        : (hit.display_name || '');
    return {
        treatment_type: 'medication',
        treatment_name: name,
        rxcui: hit.rxcui || '',
        route: guessRouteFromName(hit.display_name),
    };
}

function draftFromRow(row) {
    return {
        ...EMPTY_DRAFT,
        ...Object.fromEntries(
            Object.keys(EMPTY_DRAFT).map((k) => [k, row[k] === null || row[k] === undefined ? EMPTY_DRAFT[k] : row[k]])
        ),
        dose_dependent: !!row.dose_dependent,
    };
}

// The wire body: numbers as numbers, blanks as null.
export function bodyFromDraft(draft) {
    const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
    const txt = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);
    return {
        treatment_type: draft.treatment_type,
        treatment_name: draft.treatment_name.trim(),
        route: txt(draft.route),
        onset_minutes: num(draft.onset_minutes),
        peak_minutes: num(draft.peak_minutes),
        duration_minutes: num(draft.duration_minutes),
        hr_effect: num(draft.hr_effect) ?? 0,
        bp_sys_effect: num(draft.bp_sys_effect) ?? 0,
        bp_dia_effect: num(draft.bp_dia_effect) ?? 0,
        rr_effect: num(draft.rr_effect) ?? 0,
        spo2_effect: num(draft.spo2_effect) ?? 0,
        temp_effect: num(draft.temp_effect) ?? 0,
        etco2_effect: num(draft.etco2_effect) ?? 0,
        dose_dependent: !!draft.dose_dependent,
        base_dose: num(draft.base_dose),
        base_dose_unit: txt(draft.base_dose_unit),
        max_effect_multiplier: num(draft.max_effect_multiplier) ?? 2,
        description: txt(draft.description),
        rxcui: txt(draft.rxcui),
        pk_source: txt(draft.pk_source),
        pk_evidence_url: txt(draft.pk_evidence_url),
    };
}

function ScopeBadge({ scope }) {
    const { t } = useTranslation('authoring_meds');
    const meta = scope === 'tenant'
        ? { label: t('scope_tenant'), color: 'rohy-badge-amber' }
        : { label: t('scope_platform'), color: 'rohy-badge-cyan' };
    return <span className={`${meta.color} uppercase tracking-wide`}>{meta.label}</span>;
}

// Type labels live in the authoring_case namespace (CaseTreatmentConfig's
// category pills). Keys are static in TYPE_META; the `ns` option keeps every
// other t() in this file attributed to authoring_meds by the i18n parser.
const typeLabel = (t, type) => t(TYPE_META[type].labelKey, { ns: 'authoring_case' });

function TypeBadge({ type }) {
    const { t } = useTranslation('authoring_meds');
    const meta = TYPE_META[type];
    if (!meta) return <span className="rohy-badge-neutral">{type}</span>;
    const Icon = meta.icon;
    return (
        <span className={`${meta.badge} inline-flex items-center gap-1`}>
            <Icon className="w-3 h-3" />
            {typeLabel(t, type)}
        </span>
    );
}

function effectSummary(row) {
    return EFFECT_FIELDS
        .filter(([key]) => Number(row[key]) !== 0 && row[key] !== null && row[key] !== undefined)
        .map(([key, , unit]) => {
            const v = Number(row[key]);
            const short = key.replace('_effect', '').replace('bp_sys', 'SBP').replace('bp_dia', 'DBP').toUpperCase();
            return `${short} ${v > 0 ? '+' : ''}${v}${unit === '%' ? '%' : ''}`;
        })
        .join(' · ');
}

function Field({ label, children, wide, hint }) {
    return (
        <div className={wide ? 'col-span-2' : ''}>
            <label className="block text-[10px] uppercase tracking-wide text-neutral-400 mb-1">{label}</label>
            {children}
            {hint && <div className="text-[10px] text-neutral-500 mt-0.5">{hint}</div>}
        </div>
    );
}

function TextInput({ value, onChange, list, placeholder, disabled, name }) {
    return (
        <input
            type="text"
            name={name}
            value={value ?? ''}
            list={list}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="rohy-field w-full px-2 py-1.5 rounded text-xs"
        />
    );
}

function NumberInput({ value, onChange, min, step = 'any', disabled, name }) {
    return (
        <input
            type="number"
            name={name}
            value={value ?? ''}
            min={min}
            step={step}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="rohy-field w-full px-2 py-1.5 rounded text-xs"
        />
    );
}

/**
 * Add / edit modal. `row` null = create.
 */
function TreatmentEditor({ row, prefill, currentUser, onClose, onSaved }) {
    const { t } = useTranslation('authoring_meds');
    const toast = useToast();
    // Only a platform admin may choose (or default to) platform scope; the
    // server makes every other caller's new row a tenant row.
    const isAdmin = isPlatformAdminUser(currentUser);
    const [draft, setDraft] = useState(() => (row
        ? draftFromRow(row)
        : { ...EMPTY_DRAFT, scope: isAdmin ? 'platform' : 'tenant', ...(prefill || {}) }));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

    const handleSave = async () => {
        if (!draft.treatment_name.trim()) {
            setError(t('tl_error_name_required'));
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const body = bodyFromDraft(draft);
            if (row) {
                await apiPut(`/treatment-effects/${row.id}`, body);
                toast.success(t('tl_toast_updated'));
            } else {
                await apiPost('/treatment-effects', isAdmin ? { ...body, scope: draft.scope } : body);
                toast.success(t('tl_toast_added'));
            }
            onSaved();
        } catch (err) {
            const message = err instanceof ApiError
                ? (err.body?.error || err.message)
                : (err.message || t('tl_toast_save_failed'));
            setError(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={row ? t('tl_edit_title') : t('tl_add_title')}>
            <div className="rohy-card rounded-lg shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
                <div className="px-6 py-4 border-b border-neutral-300 flex items-center justify-between">
                    <h2 className="text-base font-semibold">{row ? t('tl_edit_title') : t('tl_add_title')}</h2>
                    <button type="button" onClick={onClose} className="rohy-subtle-button p-1.5 rounded" title={t('cancel')}>
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="px-6 py-4 overflow-y-auto grid grid-cols-2 gap-3 text-xs">
                    {prefill && (
                        <div className="col-span-2 rounded px-3 py-2 text-xs bg-teal-50 border border-teal-200 text-teal-900" data-testid="tl-prefill-hint">
                            {t('tl_prefill_hint')}
                        </div>
                    )}
                    <Field label={t('tl_field_type')}>
                        <select
                            name="treatment_type"
                            value={draft.treatment_type}
                            onChange={(e) => set('treatment_type')(e.target.value)}
                            className="rohy-field w-full px-2 py-1.5 rounded text-xs"
                        >
                            {TREATMENT_TYPES.map((type) => (
                                <option key={type} value={type}>{typeLabel(t, type)}</option>
                            ))}
                        </select>
                    </Field>
                    <Field label={t('tl_field_name_required')}>
                        <TextInput name="treatment_name" value={draft.treatment_name} onChange={set('treatment_name')} placeholder={t('tl_placeholder_name')} />
                    </Field>
                    <Field label={t('field_route')} hint={t('tl_hint_route')}>
                        <TextInput name="route" value={draft.route} onChange={set('route')} list="tl-route-suggestions" />
                        <datalist id="tl-route-suggestions">
                            {ROUTE_SUGGESTIONS.map((r) => <option key={r} value={r} />)}
                        </datalist>
                    </Field>
                    {isAdmin && !row && (
                        <Field label={t('col_scope')} hint={t('tl_hint_scope')}>
                            <select
                                name="scope"
                                value={draft.scope}
                                onChange={(e) => set('scope')(e.target.value)}
                                className="rohy-field w-full px-2 py-1.5 rounded text-xs"
                            >
                                <option value="platform">{t('scope_platform')}</option>
                                <option value="tenant">{t('scope_tenant')}</option>
                            </select>
                        </Field>
                    )}
                    {row && (
                        <Field label={t('col_scope')}>
                            <div className="py-1.5"><ScopeBadge scope={row.scope} /></div>
                        </Field>
                    )}

                    <div className="col-span-2 mt-2 text-[10px] uppercase tracking-wider text-neutral-500 border-b border-neutral-300 pb-1">
                        {t('tl_section_timing')}
                    </div>
                    <div className="col-span-2 grid grid-cols-3 gap-3">
                        <Field label={t('tl_field_onset')}>
                            <NumberInput name="onset_minutes" value={draft.onset_minutes} onChange={set('onset_minutes')} min={0} />
                        </Field>
                        <Field label={t('tl_field_peak')}>
                            <NumberInput name="peak_minutes" value={draft.peak_minutes} onChange={set('peak_minutes')} min={0} />
                        </Field>
                        <Field label={t('tl_field_duration')}>
                            <NumberInput name="duration_minutes" value={draft.duration_minutes} onChange={set('duration_minutes')} min={0} />
                        </Field>
                    </div>

                    <div className="col-span-2 mt-2 text-[10px] uppercase tracking-wider text-neutral-500 border-b border-neutral-300 pb-1">
                        {t('tl_section_effects')}
                    </div>
                    <div className="col-span-2 grid grid-cols-4 gap-3">
                        {EFFECT_FIELDS.map(([key, labelKey, unit]) => (
                            <Field key={key} label={`${t(labelKey)} (${unit})`}>
                                <NumberInput name={key} value={draft[key]} onChange={set(key)} step={key === 'temp_effect' ? 0.1 : 1} />
                            </Field>
                        ))}
                    </div>

                    <div className="col-span-2 mt-2 text-[10px] uppercase tracking-wider text-neutral-500 border-b border-neutral-300 pb-1">
                        {t('tl_section_dosing')}
                    </div>
                    <div className="col-span-2 grid grid-cols-4 gap-3 items-end">
                        <label className="flex items-center gap-2 text-xs py-1.5">
                            <input
                                type="checkbox"
                                name="dose_dependent"
                                checked={!!draft.dose_dependent}
                                onChange={(e) => set('dose_dependent')(e.target.checked)}
                            />
                            {t('tl_field_dose_dependent')}
                        </label>
                        <Field label={t('tl_field_base_dose')}>
                            <NumberInput name="base_dose" value={draft.base_dose} onChange={set('base_dose')} min={0} disabled={!draft.dose_dependent} />
                        </Field>
                        <Field label={t('field_dose_unit')}>
                            <TextInput name="base_dose_unit" value={draft.base_dose_unit} onChange={set('base_dose_unit')} placeholder="mg" disabled={!draft.dose_dependent} />
                        </Field>
                        <Field label={t('tl_field_max_multiplier')}>
                            <NumberInput name="max_effect_multiplier" value={draft.max_effect_multiplier} onChange={set('max_effect_multiplier')} min={0.1} step={0.1} disabled={!draft.dose_dependent} />
                        </Field>
                    </div>

                    <div className="col-span-2 mt-2 text-[10px] uppercase tracking-wider text-neutral-500 border-b border-neutral-300 pb-1">
                        {t('tl_section_evidence')}
                    </div>
                    <Field label={t('tl_field_description')} wide>
                        <textarea
                            name="description"
                            value={draft.description ?? ''}
                            onChange={(e) => set('description')(e.target.value)}
                            rows={2}
                            className="rohy-field w-full px-2 py-1.5 rounded text-xs"
                        />
                    </Field>
                    <Field label={t('field_rxcui')} hint={draft.rxcui ? undefined : t('tl_hint_rxcui')}>
                        <div className="flex items-center gap-2">
                            <TextInput name="rxcui" value={draft.rxcui} onChange={set('rxcui')} />
                            {draft.rxcui && (
                                <a
                                    href={`https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${encodeURIComponent(draft.rxcui)}`}
                                    target="_blank" rel="noreferrer"
                                    className="rohy-badge-teal uppercase tracking-wide hover:brightness-95 whitespace-nowrap inline-flex items-center gap-1"
                                >
                                    RxNav <ExternalLink className="w-3 h-3" />
                                </a>
                            )}
                        </div>
                    </Field>
                    <Field label={t('tl_field_pk_source')}>
                        <TextInput name="pk_source" value={draft.pk_source} onChange={set('pk_source')} placeholder={t('tl_placeholder_pk_source')} />
                    </Field>
                    <Field label={t('tl_field_pk_evidence_url')} wide>
                        <TextInput name="pk_evidence_url" value={draft.pk_evidence_url} onChange={set('pk_evidence_url')} placeholder="https://" />
                    </Field>

                    {error && (
                        <div className="col-span-2 rohy-danger-soft rounded px-3 py-2 text-xs" role="alert">{error}</div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-neutral-300">
                    <button type="button" onClick={onClose} disabled={saving} className="rohy-subtle-button flex items-center gap-1 px-3 py-1.5 text-xs rounded">
                        <X className="w-3.5 h-3.5" /> {t('cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving || !draft.treatment_name.trim()}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-cyan-700 hover:bg-cyan-600 text-white disabled:opacity-50 rounded font-bold"
                    >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        {row ? t('save') : t('tl_add_button')}
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * "Add from RxNorm / openFDA": debounced typeahead against the existing
 * /catalogue/medications/search proxy. A hit whose rxcui is already in the
 * library offers Open (filter the table to it) instead of Add.
 */
const EXT_MIN_CHARS = 2;
const EXT_DEBOUNCE_MS = 400;
function ExternalSearch({ rows, onPick, onOpen }) {
    const { t } = useTranslation('authoring_meds');
    const [query, setQuery] = useState('');
    const [hits, setHits] = useState(null); // null = nothing searched yet
    const [searching, setSearching] = useState(false);
    const [error, setError] = useState(false);
    const requestSeq = useRef(0);

    const byRxcui = useMemo(() => {
        const map = new Map();
        // First active row per rxcui wins (an inactive duplicate should not
        // hide the live one).
        rows.forEach((row) => {
            if (!row.rxcui) return;
            const key = String(row.rxcui);
            const existing = map.get(key);
            if (!existing || (!existing.is_active && row.is_active)) map.set(key, row);
        });
        return map;
    }, [rows]);

    useEffect(() => {
        const q = query.trim();
        if (q.length < EXT_MIN_CHARS) {
            setHits(null);
            setSearching(false);
            setError(false);
            return undefined;
        }
        const seq = ++requestSeq.current;
        const timer = setTimeout(async () => {
            setSearching(true);
            setError(false);
            try {
                const data = await apiFetch(`/catalogue/medications/search?q=${encodeURIComponent(q)}&sources=rxnorm,openfda&limit=20`);
                if (seq !== requestSeq.current) return;
                setHits(Array.isArray(data?.hits) ? data.hits : []);
            } catch {
                if (seq !== requestSeq.current) return;
                setHits([]);
                setError(true);
            } finally {
                if (seq === requestSeq.current) setSearching(false);
            }
        }, EXT_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [query]);

    const termLabel = (hit) => {
        if (hit.external_source === 'openfda') return t('tl_tty_label');
        const group = ttyGroup(hit.tty);
        return group ? t(TTY_GROUPS[group].labelKey) : (hit.tty || '');
    };

    return (
        <div className="rohy-card rounded-lg p-4 space-y-3" data-testid="tl-external-search">
            <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-teal-700" />
                <h4 className="text-sm font-bold">{t('tl_ext_title')}</h4>
            </div>
            <p className="text-xs text-neutral-500">{t('tl_ext_intro')}</p>
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('tl_ext_placeholder')}
                    aria-label={t('tl_ext_title')}
                    className="rohy-field w-full pl-10 pr-4 py-2 rounded-lg text-sm"
                />
                {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-neutral-500" />}
            </div>
            {query.trim().length > 0 && query.trim().length < EXT_MIN_CHARS && (
                <div className="text-xs text-neutral-500">{t('tl_ext_min_chars', { count: EXT_MIN_CHARS })}</div>
            )}
            {error && <div className="text-xs rohy-danger-soft rounded px-3 py-2" role="alert">{t('tl_ext_error')}</div>}
            {hits && !error && hits.length === 0 && !searching && (
                <div className="text-xs text-neutral-500">{t('tl_ext_empty')}</div>
            )}
            {hits && hits.length > 0 && (
                <ul className="divide-y divide-neutral-200 max-h-72 overflow-y-auto rounded border border-neutral-200" data-testid="tl-external-hits">
                    {hits.map((hit) => {
                        const existing = hit.rxcui ? byRxcui.get(String(hit.rxcui)) : null;
                        const key = `${hit.external_source}:${hit.external_id || hit.rxcui || hit.display_name}`;
                        const name = hit.display_name || hit.generic_name || hit.rxcui || '—';
                        return (
                            <li key={key} className="flex items-center gap-3 px-3 py-2 text-xs" data-testid={`tl-hit-${hit.external_source}-${hit.rxcui || hit.external_id}`}>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium truncate">{name}</span>
                                        {termLabel(hit) && <span className="rohy-badge-neutral uppercase tracking-wide">{termLabel(hit)}</span>}
                                        <span className="rohy-badge-teal uppercase tracking-wide">{hit.external_source === 'openfda' ? 'openFDA' : 'RxNorm'}</span>
                                        {existing && (
                                            <span className="rohy-badge-green inline-flex items-center gap-1 uppercase tracking-wide">
                                                <Check className="w-3 h-3" /> {t('tl_ext_in_library')}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[11px] text-neutral-500 flex items-center gap-2">
                                        {hit.rxcui && <span>RxCUI {hit.rxcui}</span>}
                                        {hit.external_source === 'openfda' && hit.generic_name && hit.generic_name !== hit.display_name && (
                                            <span>{t('tl_ext_generic', { name: hit.generic_name })}</span>
                                        )}
                                    </div>
                                </div>
                                {existing ? (
                                    <button
                                        type="button"
                                        onClick={() => onOpen(existing)}
                                        className="rohy-subtle-button px-2 py-1 rounded text-xs"
                                        aria-label={`${t('tl_ext_open')} ${name}`}
                                    >
                                        {t('tl_ext_open')}
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => onPick(hit)}
                                        className="flex items-center gap-1 px-2 py-1 bg-cyan-700 hover:bg-cyan-600 text-white rounded text-xs font-bold"
                                        aria-label={`${t('tl_ext_add')} ${name}`}
                                    >
                                        <Plus className="w-3 h-3" /> {t('tl_ext_add')}
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

export default function TreatmentsLibraryManager() {
    const { t } = useTranslation('authoring_meds');
    const toast = useToast();
    const { user: currentUser } = useAuth();

    const isEducator = rankOf(currentUser) >= ROLE_RANKS.educator;

    const [rows, setRows] = useState([]);
    // Students never fetch, so they must not start in the loading state.
    const [loading, setLoading] = useState(isEducator);
    const [typeFilter, setTypeFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [statusView, setStatusView] = useState('active');
    const [editor, setEditor] = useState(null); // null | { row: null|object, prefill?: object }
    const [busyId, setBusyId] = useState(null);

    const fetchRows = useCallback(async () => {
        setLoading(true);
        try {
            const data = await apiFetch('/treatment-effects?include_inactive=1');
            setRows(data.effects || []);
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('tl_toast_load_failed'));
        } finally {
            setLoading(false);
        }
    }, [toast, t]);

    useEffect(() => {
        if (isEducator) fetchRows();
    }, [isEducator, fetchRows]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return rows.filter((row) => {
            if (!statusMatches(statusView, row)) return false;
            if (typeFilter !== 'all' && row.treatment_type !== typeFilter) return false;
            if (!q) return true;
            return (
                row.treatment_name?.toLowerCase().includes(q) ||
                row.route?.toLowerCase().includes(q) ||
                row.description?.toLowerCase().includes(q) ||
                row.rxcui?.toLowerCase().includes(q)
            );
        });
    }, [rows, search, typeFilter, statusView]);

    // Status counts are global; type counts follow the current status view.
    const statusCounts = useMemo(() => ({
        active: rows.filter((r) => r.is_active).length,
        inactive: rows.filter((r) => !r.is_active).length,
        all: rows.length,
    }), [rows]);

    const counts = useMemo(() => {
        const inView = rows.filter((r) => statusMatches(statusView, r));
        return {
            all: inView.length,
            ...Object.fromEntries(TREATMENT_TYPES.map((type) => [type, inView.filter((r) => r.treatment_type === type).length])),
        };
    }, [rows, statusView]);

    // "Open" from the external search: filter the table down to that row
    // (switching to the view it lives in) rather than opening an editor the
    // user may not be allowed to save.
    const revealRow = (row) => {
        setStatusView(row.is_active ? 'active' : 'inactive');
        setTypeFilter('all');
        setSearch(row.treatment_name);
    };

    const handleDeactivate = async (row) => {
        const ok = await toast.confirm(t('tl_confirm_deactivate', { name: row.treatment_name }), {
            title: t('tl_deactivate'), type: 'danger', confirmText: t('tl_deactivate'),
        });
        if (!ok) return;
        setBusyId(row.id);
        try {
            await apiDelete(`/treatment-effects/${row.id}`);
            toast.success(t('tl_toast_deactivated'));
            await fetchRows();
        } catch (err) {
            toast.error(err instanceof ApiError ? (err.body?.error || err.message) : t('tl_toast_save_failed'));
        } finally {
            setBusyId(null);
        }
    };

    const handleRestore = async (row) => {
        setBusyId(row.id);
        try {
            await apiPut(`/treatment-effects/${row.id}/restore`, {});
            toast.success(t('tl_toast_restored'));
            await fetchRows();
        } catch (err) {
            toast.error(err instanceof ApiError ? (err.body?.error || err.message) : t('tl_toast_save_failed'));
        } finally {
            setBusyId(null);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
            </div>
        );
    }

    if (!isEducator) {
        return (
            <div className="rohy-card rounded-lg p-6 text-sm rohy-table-muted">
                {t('tl_educator_required')}
            </div>
        );
    }

    return (
        <div className="space-y-4 rohy-admin-light">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Stethoscope className="w-5 h-5 text-teal-700" />
                    <h3 className="text-lg font-bold">{t('tl_title')}</h3>
                    <span className="rohy-count-pill">
                        {t('tl_count', { count: counts.all })}
                    </span>
                </div>
                <div className="flex gap-2">
                    <button onClick={fetchRows} className="rohy-subtle-button p-2 rounded" title={t('refresh')}>
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setEditor({ row: null })}
                        className="flex items-center gap-1 px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 text-white rounded text-sm font-bold"
                    >
                        <Plus className="w-4 h-4" />
                        {t('tl_add_button')}
                    </button>
                </div>
            </div>

            <p className="text-xs text-neutral-500">{t('tl_intro')}</p>

            <ExternalSearch
                rows={rows}
                onPick={(hit) => setEditor({ row: null, prefill: prefillFromHit(hit) })}
                onOpen={revealRow}
            />

            <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('tl_type_filter_label')}>
                    <button
                        type="button"
                        onClick={() => setTypeFilter('all')}
                        className={`px-3 py-1 rounded-full text-xs font-medium ${typeFilter === 'all' ? 'rohy-admin-tab-active' : 'rohy-admin-tab'}`}
                    >
                        {t('category_all', { ns: 'authoring_case' })} ({counts.all})
                    </button>
                    {TREATMENT_TYPES.map((type) => {
                        const Icon = TYPE_META[type].icon;
                        return (
                            <button
                                key={type}
                                type="button"
                                onClick={() => setTypeFilter(type)}
                                className={`px-3 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1 ${typeFilter === type ? 'rohy-admin-tab-active' : 'rohy-admin-tab'}`}
                            >
                                <Icon className="w-3 h-3" />
                                {typeLabel(t, type)} ({counts[type]})
                            </button>
                        );
                    })}
                </div>
                <div className="ml-auto inline-flex rounded-full overflow-hidden border border-neutral-300" role="group" aria-label={t('tl_status_filter_label')}>
                    {STATUS_VIEWS.map((view) => (
                        <button
                            key={view}
                            type="button"
                            onClick={() => setStatusView(view)}
                            aria-pressed={statusView === view}
                            className={`px-3 py-1 text-xs font-medium ${statusView === view ? 'rohy-admin-tab-active' : 'rohy-admin-tab'}`}
                        >
                            {t(STATUS_LABEL_KEYS[view])} ({statusCounts[view]})
                        </button>
                    ))}
                </div>
            </div>

            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('tl_search_placeholder')}
                    className="rohy-field w-full pl-10 pr-4 py-2 rounded-lg text-sm"
                />
            </div>

            <div className="rohy-table-shell max-h-[600px] overflow-y-auto rounded-lg">
                <table className="w-full text-sm">
                    <thead className="rohy-table-head sticky top-0 z-10">
                        <tr>
                            <th className="px-4 py-3 text-left font-bold">{t('col_name')}</th>
                            <th className="px-4 py-3 text-left font-bold">{t('tl_col_type')}</th>
                            <th className="px-4 py-3 text-left font-bold">{t('col_route')}</th>
                            <th className="px-4 py-3 text-left font-bold">{t('tl_col_timing')}</th>
                            <th className="px-4 py-3 text-left font-bold">{t('tl_col_effects')}</th>
                            <th className="px-4 py-3 text-left font-bold">{t('col_scope')}</th>
                            <th className="px-4 py-3 text-right font-bold w-28">{t('col_actions')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.length === 0 ? (
                            <tr>
                                <td colSpan="7" className="text-center py-8 text-neutral-500">
                                    {search ? t('tl_empty_no_match') : (statusView === 'inactive' ? t('tl_empty_inactive') : t('tl_empty'))}
                                </td>
                            </tr>
                        ) : filtered.map((row) => {
                            const editable = canEditRow(currentUser, row);
                            const inactive = !row.is_active;
                            return (
                                <tr key={row.id} className={`rohy-table-row ${inactive ? 'opacity-60' : ''}`} data-testid={`tl-row-${row.id}`}>
                                    <td className="rohy-table-cell px-4 py-2 font-medium">
                                        <div className="flex items-center gap-2">
                                            {row.treatment_name}
                                            {inactive && <span className="rohy-badge-neutral uppercase tracking-wide">{t('tl_badge_inactive')}</span>}
                                        </div>
                                        {row.description && <div className="text-[11px] text-neutral-500 truncate max-w-xs">{row.description}</div>}
                                    </td>
                                    <td className="rohy-table-cell px-4 py-2"><TypeBadge type={row.treatment_type} /></td>
                                    <td className="rohy-table-cell px-4 py-2 rohy-table-muted uppercase text-xs">{row.route || '-'}</td>
                                    <td className="rohy-table-cell px-4 py-2 rohy-table-muted text-xs whitespace-nowrap">
                                        {t('tl_timing_summary', { onset: row.onset_minutes, peak: row.peak_minutes, duration: row.duration_minutes })}
                                    </td>
                                    <td className="rohy-table-cell px-4 py-2 rohy-table-muted text-xs">{effectSummary(row) || '—'}</td>
                                    <td className="rohy-table-cell px-4 py-2"><ScopeBadge scope={row.scope} /></td>
                                    <td className="rohy-table-cell px-4 py-2 text-right">
                                        {editable ? (
                                            <div className="inline-flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => setEditor({ row })}
                                                    className="rohy-subtle-button p-1 rounded"
                                                    title={t('edit')}
                                                    aria-label={`${t('edit')} ${row.treatment_name}`}
                                                    disabled={busyId === row.id}
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                {inactive ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRestore(row)}
                                                        className="rohy-subtle-button p-1 rounded"
                                                        title={t('tl_restore')}
                                                        aria-label={`${t('tl_restore')} ${row.treatment_name}`}
                                                        disabled={busyId === row.id}
                                                    >
                                                        <RotateCcw className="w-4 h-4" />
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeactivate(row)}
                                                        className="rohy-danger-icon-button p-1 rounded"
                                                        title={t('tl_deactivate')}
                                                        aria-label={`${t('tl_deactivate')} ${row.treatment_name}`}
                                                        disabled={busyId === row.id}
                                                    >
                                                        <Ban className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </div>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-[10px] text-neutral-500" title={t('read_only_title')}>
                                                <Lock className="w-3 h-3" />
                                                {t('read_only')}
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {editor && (
                <TreatmentEditor
                    row={editor.row}
                    prefill={editor.prefill}
                    currentUser={currentUser}
                    onClose={() => setEditor(null)}
                    onSaved={() => { setEditor(null); fetchRows(); }}
                />
            )}
        </div>
    );
}
