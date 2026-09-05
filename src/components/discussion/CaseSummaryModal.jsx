import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Activity, Award, FlaskConical, Pill, Stethoscope, Image as ImageIcon } from 'lucide-react';
import { apiFetch } from '../../services/apiClient';
import { parseConfig } from '../../utils/parseConfig.js';
import { resolveCaseHistory } from '../../utils/casePromptContext.js';
import { regionLabel, techniqueLabel } from '../examination/examinationLabels';
import EventLogger, { COMPONENTS, OBJECT_TYPES } from '../../services/eventLogger';

async function safeFetch(path) {
    try {
        return await apiFetch(path);
    } catch { return null; }
}

// Initial-vitals resolution mirrors PatientMonitor's priority chain (the
// "Load initial vitals and scenario from case data" effect in
// src/components/monitor/PatientMonitor.jsx): initialVitals → scenario
// first-frame params → legacy flat config keys (hr/spo2/rr/temp/sbp/dbp/etco2).
// Duplicated locally rather than extracted because the monitor's chain is
// pinned by source-contract tests — keep the two in sync if either changes.
// (bug report 2.9.15 #16: the modal read only initialVitals, so scenario-only
// and legacy-flat cases hid the whole section.)
function resolveInitialVitals(activeCase, cfg) {
    const configured = cfg.initialVitals || cfg.initial_vitals;
    if (configured && Object.keys(configured).length > 0) return configured;

    const timeline = activeCase?.scenario?.timeline;
    const firstFrame = Array.isArray(timeline) && timeline.length > 0
        ? [...timeline].sort((a, b) => a.time - b.time)[0]
        : null;
    if (firstFrame?.params && Object.keys(firstFrame.params).length > 0) return firstFrame.params;

    const legacy = {
        hr: cfg.hr,
        spo2: cfg.spo2,
        rr: cfg.rr,
        temp: cfg.temp,
        bpSys: cfg.sbp ?? cfg.bpSys,
        bpDia: cfg.dbp ?? cfg.bpDia,
        etco2: cfg.etco2,
    };
    return Object.fromEntries(Object.entries(legacy).filter(([, value]) => value != null));
}

// Pulls together the case context + everything the session captured so the
// learner has a single formatted page to review before/while debriefing.
// Uses the existing read-only session endpoints — no new backend work.
export default function CaseSummaryModal({ activeCase, sessionId, onClose }) {
    const { t } = useTranslation('discussion');
    // Region and technique names are keyed in the `examination` namespace, not
    // this one — same second-hook pattern PhysicalExamEditor uses so the exam
    // room and the summary say the same words for the same body part.
    const { t: tExam } = useTranslation('examination');
    const [data, setData] = useState({ labs: null, treatments: null, exams: null, radiology: null, debrief: null });
    const [loading, setLoading] = useState(!!sessionId);

    // Reading the case summary is record review (assessing), bracketed.
    useEffect(() => {
        EventLogger.panelOpened(OBJECT_TYPES.PATIENT_RECORD, 'case_summary', 'Case summary', COMPONENTS.DISCUSSION_SCREEN);
        return () => EventLogger.panelClosed(OBJECT_TYPES.PATIENT_RECORD, 'case_summary', 'Case summary', COMPONENTS.DISCUSSION_SCREEN);
    }, []);

    useEffect(() => {
        if (!sessionId) return;
        let cancelled = false;
        Promise.all([
            safeFetch(`/sessions/${sessionId}/lab-results`),
            safeFetch(`/sessions/${sessionId}/treatment-orders`),
            safeFetch(`/sessions/${sessionId}/exam-findings`),
            safeFetch(`/sessions/${sessionId}/radiology-orders`),
            safeFetch(`/sessions/${sessionId}/treatment-debrief`),
        ]).then(([labs, treatments, exams, radiology, debrief]) => {
            if (!cancelled) {
                setData({ labs, treatments, exams, radiology, debrief });
                setLoading(false);
            }
        });
        return () => { cancelled = true; };
    }, [sessionId]);

    const cfg = parseConfig(activeCase?.config);
    const demographics = cfg.demographics || {};
    // Bug report 2.9.15 #16: this used to read cfg.structuredHistory only, via
    // keys (historyOfPresentIllness / pastMedicalHistory) nothing ever wrote —
    // so History rendered empty for every case. resolveCaseHistory merges
    // structuredHistory (all key aliases) with the canonical runtime mirror
    // clinicalRecords.history, same as the AI prompt builders.
    const history = resolveCaseHistory(cfg);
    const initial = resolveInitialVitals(activeCase, cfg);
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
                        <Row label={t('hpi')} value={history.hpi} block />
                        <Row label={t('label_pmh')} value={history.pmh} block />
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
                                {/* Bug report 2.9.15 #16: physical_exam_findings rows carry
                                    `body_region` and `finding` (see the INSERT in
                                    server/routes/cases-routes.js) — the old region_id /
                                    finding_text keys never existed, so every row rendered
                                    blank. */}
                                <FindingsList items={data.exams?.findings || data.exams?.exam_findings} render={(f, i) => {
                                    // `body_region` and `exam_type` are stored ids
                                    // ('thighRight', 'auscultation'). Rendering them raw
                                    // put "thighRight — upperBack" in front of learners;
                                    // regionLabel / techniqueLabel are the same
                                    // resolvers the exam room uses, and they fall back
                                    // to the raw id for author-defined regions.
                                    const region = f.body_region ? regionLabel(tExam, f.body_region) : '';
                                    const technique = f.exam_type ? techniqueLabel(tExam, f.exam_type) : '';
                                    return (
                                        <li key={f.id ?? i} className="text-sm text-slate-200">
                                            <span className="font-medium text-slate-100">{region || technique}</span>
                                            {technique && region ? ` — ${technique}` : ''}
                                            {f.finding && <>: <span className="text-slate-300">{f.finding}</span></>}
                                        </li>
                                    );
                                }} empty={t('no_exams_recorded')} />
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
                                {/* Bug report 2.9.15 #10 (bonus): treatment_orders rows carry the
                                    name in `treatment_item` — reading treatment_name rendered every
                                    row blank. (The row param was also shadowing i18n's t().) */}
                                <FindingsList items={data.treatments?.orders || data.treatments?.treatment_orders} render={(o, i) => (
                                    <li key={o.id ?? i} className="text-sm text-slate-200">
                                        <span className="font-medium text-slate-100">{o.treatment_item || o.treatment_name || o.name}</span>
                                        {o.dose && <> — {o.dose}{o.unit || ''}</>}
                                        {o.route && <span className="text-slate-400 ml-1">({o.route})</span>}
                                    </li>
                                )} empty={t('no_treatments_administered')} />
                            </Section>

                            {data.debrief && (
                                <Section title={t('section_treatment_debrief')} icon={<Award className="w-4 h-4" />}>
                                    <div className="text-sm font-semibold text-slate-100">
                                        {t('debrief_total_points', { points: data.debrief.total_points ?? 0 })}
                                    </div>
                                    <FindingsList items={data.debrief.ordered} render={(o, i) => (
                                        <li key={i} className="text-sm text-slate-200">
                                            <span className="font-medium text-slate-100">{o.treatment_item}</span>
                                            {o.points_awarded > 0 && (
                                                <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-emerald-900/40 text-emerald-300 border border-emerald-800/50">
                                                    {t('debrief_points_chip', { points: o.points_awarded })}
                                                </span>
                                            )}
                                            {o.feedback && <div className="text-slate-300">{o.feedback}</div>}
                                        </li>
                                    )} empty={t('no_treatments_administered')} />
                                    <div className="pt-2 border-t border-slate-700">
                                        <div className="text-xs uppercase font-semibold text-slate-400 mb-1">{t('debrief_missed_heading')}</div>
                                        {data.debrief.pending ? (
                                            <div className="text-sm text-slate-400 italic">{t('debrief_missed_pending')}</div>
                                        ) : (Array.isArray(data.debrief.missed) && data.debrief.missed.length > 0 ? (
                                            <ul className="space-y-1.5">
                                                {data.debrief.missed.map((m, i) => (
                                                    <li key={i} className="text-sm text-slate-200">
                                                        <span className="font-medium text-amber-300">{m.treatment_name}</span>
                                                        {m.feedback_if_missed && <div className="text-slate-300">{m.feedback_if_missed}</div>}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <div className="text-sm text-slate-400 italic">{t('debrief_none_missed')}</div>
                                        ))}
                                    </div>
                                </Section>
                            )}
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
