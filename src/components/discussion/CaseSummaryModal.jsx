import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Activity, FlaskConical, Pill, Stethoscope, Image as ImageIcon } from 'lucide-react';
import { apiFetch } from '../../services/apiClient';
import { parseConfig } from '../../utils/parseConfig.js';

async function safeFetch(path) {
    try {
        return await apiFetch(path);
    } catch { return null; }
}

// Pulls together the case context + everything the session captured so the
// learner has a single formatted page to review before/while debriefing.
// Uses the existing read-only session endpoints — no new backend work.
export default function CaseSummaryModal({ activeCase, sessionId, onClose }) {
    const { t } = useTranslation('discussion');
    const [data, setData] = useState({ labs: null, treatments: null, exams: null, radiology: null });
    const [loading, setLoading] = useState(!!sessionId);

    useEffect(() => {
        if (!sessionId) return;
        let cancelled = false;
        Promise.all([
            safeFetch(`/sessions/${sessionId}/lab-results`),
            safeFetch(`/sessions/${sessionId}/treatment-orders`),
            safeFetch(`/sessions/${sessionId}/exam-findings`),
            safeFetch(`/sessions/${sessionId}/radiology-orders`),
        ]).then(([labs, treatments, exams, radiology]) => {
            if (!cancelled) {
                setData({ labs, treatments, exams, radiology });
                setLoading(false);
            }
        });
        return () => { cancelled = true; };
    }, [sessionId]);

    const cfg = parseConfig(activeCase?.config);
    const demographics = cfg.demographics || {};
    const history = cfg.structuredHistory || {};
    // Configs store initial vitals under `initialVitals` (camelCase); accept the
    // legacy `initial_vitals` snake_case too for older rows.
    const initial = cfg.initialVitals || cfg.initial_vitals || {};
    // Prefer structured chief complaint, then the denormalized column. Never
    // the case description — see PatientSummaryCard for why (bug #2).
    const chiefComplaint = history.chiefComplaint || activeCase?.chief_complaint || null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/60 backdrop-blur-sm">
            <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-slate-700">
                <header className="flex items-center justify-between px-6 py-4 border-b border-slate-700 bg-slate-900/50 rounded-t-2xl">
                    <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-indigo-400">{t('case_debrief_summary')}</div>
                        <h2 className="text-lg font-semibold text-slate-100">
                            {cfg.patient_name || activeCase?.name || t('patient_fallback')}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full p-2 hover:bg-slate-700 text-slate-300"
                        aria-label={t('close_summary')}
                    >
                        <X className="w-5 h-5" />
                    </button>
                </header>

                <div className="overflow-y-auto px-6 py-5 space-y-6 text-slate-100">
                    <Section title={t('section_demographics')}>
                        <Row label={t('label_name')} value={cfg.patient_name || activeCase?.name} />
                        <Row label={t('label_age')} value={demographics.age ? t('age_years', { age: demographics.age }) : null} />
                        <Row label={t('label_gender')} value={demographics.gender} />
                        <Row label={t('label_mrn')} value={demographics.mrn} />
                    </Section>

                    <Section title={t('section_history')} icon={<Stethoscope className="w-4 h-4" />}>
                        <Row label={t('chief_complaint')} value={chiefComplaint} block />
                        <Row label={t('hpi')} value={history.historyOfPresentIllness} block />
                        <Row label={t('label_pmh')} value={history.pastMedicalHistory} block />
                        <Row label={t('label_medications')} value={history.medications} block />
                        <Row label={t('label_allergies')} value={history.allergies} block />
                    </Section>

                    {Object.keys(initial).length > 0 && (
                        <Section title={t('section_initial_vitals')} icon={<Activity className="w-4 h-4" />}>
                            <div className="grid grid-cols-3 gap-3">
                                {initial.hr != null && <Vital label={t('vital_hr')} value={t('vital_bpm', { value: initial.hr })} />}
                                {initial.bpSys != null && <Vital label={t('vital_bp')} value={`${initial.bpSys}/${initial.bpDia ?? '?'}`} />}
                                {initial.spo2 != null && <Vital label={t('vital_spo2')} value={`${initial.spo2}%`} />}
                                {initial.rr != null && <Vital label={t('vital_rr')} value={t('vital_per_min', { value: initial.rr })} />}
                                {initial.temp != null && <Vital label={t('vital_temp')} value={t('vital_celsius', { value: initial.temp })} />}
                                {initial.etco2 != null && <Vital label={t('vital_etco2')} value={`${initial.etco2}`} />}
                            </div>
                        </Section>
                    )}

                    {loading ? (
                        <div className="text-sm text-slate-400 italic">{t('loading_findings')}</div>
                    ) : (
                        <>
                            <Section title={t('section_exam_findings')} icon={<Stethoscope className="w-4 h-4" />}>
                                <FindingsList items={data.exams?.findings || data.exams?.exam_findings} render={(f, i) => (
                                    <li key={f.id ?? i} className="text-sm text-slate-200">
                                        <span className="font-medium text-slate-100">{f.region_id || f.region || f.exam_type}</span>
                                        {f.exam_type && f.region_id ? ` — ${f.exam_type}` : ''}
                                        {f.finding_text && <>: <span className="text-slate-300">{f.finding_text}</span></>}
                                    </li>
                                )} empty={t('no_exams_recorded')} />
                            </Section>

                            <Section title={t('section_lab_results')} icon={<FlaskConical className="w-4 h-4" />}>
                                <FindingsList items={data.labs?.results || data.labs?.lab_results} render={(r, i) => (
                                    <li key={r.id ?? i} className="text-sm text-slate-200">
                                        <span className="font-medium text-slate-100">{r.test_name || r.name}</span>
                                        {r.current_value != null && <>: <span className="text-slate-50 font-semibold">{r.current_value}</span> <span className="text-slate-400">{r.unit || ''}</span></>}
                                        {r.flag && <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-amber-900/40 text-amber-300 border border-amber-800/50">{r.flag}</span>}
                                    </li>
                                )} empty={t('no_labs_returned')} />
                            </Section>

                            <Section title={t('section_imaging')} icon={<ImageIcon className="w-4 h-4" />}>
                                <FindingsList items={data.radiology?.orders || data.radiology?.radiology_orders} render={(r, i) => (
                                    <li key={r.id ?? i} className="text-sm text-slate-200">
                                        <span className="font-medium text-slate-100">{r.study_name || r.modality || r.test_name}</span>
                                        {r.findings && <>: <span className="text-slate-300">{r.findings}</span></>}
                                    </li>
                                )} empty={t('no_imaging_ordered')} />
                            </Section>

                            <Section title={t('section_treatments')} icon={<Pill className="w-4 h-4" />}>
                                <FindingsList items={data.treatments?.orders || data.treatments?.treatment_orders} render={(t, i) => (
                                    <li key={t.id ?? i} className="text-sm text-slate-200">
                                        <span className="font-medium text-slate-100">{t.treatment_name || t.name}</span>
                                        {t.dose && <> — {t.dose}{t.unit || ''}</>}
                                        {t.route && <span className="text-slate-400 ml-1">({t.route})</span>}
                                    </li>
                                )} empty={t('no_treatments_administered')} />
                            </Section>
                        </>
                    )}
                </div>

                <footer className="px-6 py-3 border-t border-slate-700 bg-slate-900/50 rounded-b-2xl">
                    <div className="text-xs text-slate-400">
                        {t('summary_footer_hint')}
                    </div>
                </footer>
            </div>
        </div>
    );
}

function Section({ title, icon, children }) {
    return (
        <section>
            <h3 className="text-sm font-semibold text-slate-100 mb-2 flex items-center gap-2">
                {icon && <span className="text-indigo-400">{icon}</span>}
                {title}
            </h3>
            <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3 space-y-1.5">
                {children}
            </div>
        </section>
    );
}

function Row({ label, value, block }) {
    if (!value) return null;
    if (block) {
        return (
            <div>
                <div className="text-xs uppercase font-semibold text-slate-400">{label}</div>
                <div className="text-sm text-slate-100 whitespace-pre-wrap">{value}</div>
            </div>
        );
    }
    return (
        <div className="flex gap-2 text-sm">
            <span className="font-medium text-slate-400 min-w-[6rem]">{label}:</span>
            <span className="text-slate-100">{value}</span>
        </div>
    );
}

function Vital({ label, value }) {
    return (
        <div className="rounded bg-slate-800 border border-slate-700 px-3 py-2">
            <div className="text-xs uppercase text-slate-400 font-semibold">{label}</div>
            <div className="text-base font-semibold text-slate-100">{value}</div>
        </div>
    );
}

function FindingsList({ items, render, empty }) {
    if (!Array.isArray(items) || items.length === 0) {
        return <div className="text-sm text-slate-400 italic">{empty}</div>;
    }
    return <ul className="space-y-1.5">{items.map(render)}</ul>;
}
