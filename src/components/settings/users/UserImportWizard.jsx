import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Papa from 'papaparse';
import { X, Upload, Download, CheckCircle2, AlertTriangle, ArrowRight, ArrowLeft, ClipboardPaste, GraduationCap } from 'lucide-react';
import { useToast } from '../../../contexts/ToastContext';
import { ApiError } from '../../../services/apiClient';
import * as userService from '../../../services/userService';

const FIELDS = ['username', 'name', 'email', 'password', 'role', 'class'];
const SYNONYMS = {
    username: ['username', 'user', 'login', 'userid', 'user_id'],
    name: ['name', 'fullname', 'full name', 'full_name', 'displayname'],
    email: ['email', 'e-mail', 'mail', 'emailaddress'],
    password: ['password', 'pass', 'pwd'],
    role: ['role', 'type', 'usertype'],
    class: ['class', 'cohort', 'section', 'group', 'classroom', 'course', 'course code', 'course_code', 'join code', 'join_code', 'registration code', 'registration_code'],
};
const VALID_ROLES = ['guest', 'student', 'user', 'reviewer', 'educator', 'admin'];
const ROLE_RANK = { guest: 0, student: 1, user: 1, reviewer: 2, educator: 3, admin: 4 };

function autoMap(headers) {
    const map = {};
    for (const field of FIELDS) {
        const hit = headers.find(h => SYNONYMS[field].includes(String(h).trim().toLowerCase()));
        map[field] = hit || '';
    }
    return map;
}

export default function UserImportWizard({ cohorts, existingUsers, myRank, onClose, onDone }) {
    const { t } = useTranslation('teacher_users');
    const toast = useToast();
    const [step, setStep] = useState(1);
    const [headers, setHeaders] = useState([]);
    const [rawRows, setRawRows] = useState([]);
    const [mapping, setMapping] = useState({});
    const [cohortId, setCohortId] = useState('');
    const [pasteText, setPasteText] = useState('');
    const [committing, setCommitting] = useState(false);
    const [validating, setValidating] = useState(false);
    const [serverPreview, setServerPreview] = useState(null);
    const [result, setResult] = useState(null);

    const existingUsernames = useMemo(() => new Set(existingUsers.map(u => String(u.username).toLowerCase())), [existingUsers]);
    const existingEmails = useMemo(() => new Set(existingUsers.map(u => String(u.email).toLowerCase())), [existingUsers]);
    // Known classes = names AND join codes, mirroring the server's /users/import
    // lookup (which resolves `class` by name OR join_code) so a valid join code
    // isn't false-flagged as "Unknown class".
    const knownClasses = useMemo(() => {
        const s = new Set();
        for (const c of cohorts) {
            if (c.name) s.add(String(c.name).toLowerCase());
            if (c.join_code) s.add(String(c.join_code).toLowerCase());
        }
        return s;
    }, [cohorts]);

    const parseText = (text) => {
        const out = Papa.parse(text, { header: true, skipEmptyLines: true });
        const hdrs = (out.meta?.fields || []).filter(Boolean);
        if (hdrs.length === 0) { toast.error(t('err_no_columns')); return; }
        setHeaders(hdrs);
        setRawRows(out.data || []);
        setMapping(autoMap(hdrs));
        setStep(2);
    };

    const onFile = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => parseText(String(ev.target.result || ''));
        reader.readAsText(file);
    };

    const mapped = useMemo(() => rawRows.map(r => {
        const o = {};
        for (const f of FIELDS) o[f] = mapping[f] ? String(r[mapping[f]] ?? '').trim() : '';
        return o;
    }), [rawRows, mapping]);

    const validated = useMemo(() => {
        const seenU = new Set(), seenE = new Set();
        return mapped.map((row, i) => {
            const errors = [];
            const u = row.username.toLowerCase(), e = row.email.toLowerCase();
            if (!row.username || !row.email) errors.push(t('verr_missing'));
            if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) errors.push(t('verr_bad_email'));
            const role = (row.role || 'student').toLowerCase();
            if (row.role && !VALID_ROLES.includes(role)) errors.push(t('verr_invalid_role'));
            if (VALID_ROLES.includes(role) && (ROLE_RANK[role] ?? 0) > myRank) errors.push(t('verr_role_above'));
            if (u && seenU.has(u)) errors.push(t('verr_dup')); else if (u) seenU.add(u);
            if (e && seenE.has(e)) errors.push(t('verr_dup')); else if (e) seenE.add(e);
            const exists = existingUsernames.has(u) || existingEmails.has(e);
            const cls = (row.class || '').toLowerCase();
            if (cls && !knownClasses.has(cls)) errors.push(t('verr_unknown_class'));
            if (!exists && !row.password) errors.push(t('verr_password_required'));
            let status = 'create';
            if (errors.length) status = 'error';
            else if (exists) status = row.class || cohortId ? 'enroll' : 'skip';
            return { i, row, errors, status, exists };
        });
    }, [mapped, existingUsernames, existingEmails, knownClasses, myRank, cohortId]);

    const counts = useMemo(() => validated.reduce((a, v) => { a[v.status] = (a[v.status] || 0) + 1; return a; }, {}), [validated]);
    const serverFailedRows = useMemo(
        () => new Set((serverPreview?.failed || []).map(f => Number(f.row)).filter(Boolean)),
        [serverPreview],
    );
    const commitRows = useMemo(
        () => validated
            .filter(v => v.status !== 'error' && !serverFailedRows.has(v.i + 1))
            .map(v => v.row),
        [validated, serverFailedRows],
    );
    const defaultCohort = useMemo(
        () => cohorts.find(c => String(c.id) === String(cohortId)),
        [cohorts, cohortId],
    );
    const assignmentMode = useMemo(() => {
        const hasMappedClass = !!mapping.class;
        const rowsWithClass = mapped.filter(r => r.class).length;
        if (hasMappedClass && rowsWithClass) return t('assign_mode_csv', { count: rowsWithClass });
        if (defaultCohort) return t('assign_mode_default', { name: defaultCohort.name });
        return t('assign_mode_none');
    }, [mapping.class, mapped, defaultCohort]);

    const commit = async () => {
        setCommitting(true);
        try {
            const { results } = await userService.importUsers({
                rows: commitRows,
                cohortId: cohortId ? Number(cohortId) : undefined,
                dryRun: false,
            });
            setResult(results);
            setStep(4);
            toast.success(t('toast_imported', { created: results.created.length, enrolled: results.enrolled.length }));
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('err_import'));
        } finally {
            setCommitting(false);
        }
    };

    const reviewWithServer = async () => {
        if (!mapping.username || !mapping.email) return;
        setValidating(true);
        try {
            const { results } = await userService.importUsers({
                rows: mapped,
                cohortId: cohortId ? Number(cohortId) : undefined,
                dryRun: true,
            });
            setServerPreview(results);
            setStep(3);
        } catch (err) {
            toast.error(err instanceof ApiError ? err.message : t('err_import_validation'));
        } finally {
            setValidating(false);
        }
    };

    const downloadTemplate = () => downloadCsv('user_import_template.csv',
        'username,name,email,password,role,class\njdoe,Jane Doe,jane@school.edu,Passw0rd!,student,Basic course\nasmith,Amina Smith,amina@school.edu,Passw0rd!,student,ABC123\n');

    const downloadErrors = () => {
        const lines = ['row,username,email,role,class,error'];
        validated.filter(v => v.status === 'error').forEach(v => {
            lines.push([v.i + 1, v.row.username, v.row.email, v.row.role, v.row.class, v.errors.join('; ')].map(csvCell).join(','));
        });
        (result?.failed || []).forEach(f => {
            lines.push([f.row, f.username, f.email, f.role || '', f.class || '', f.error].map(csvCell).join(','));
        });
        downloadCsv('user_import_errors.csv', lines.join('\n'));
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
            <div className="rohy-card rounded-xl w-full max-w-3xl max-h-[88vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200">
                    <h3 className="font-bold flex items-center gap-2"><Upload className="w-4 h-4 text-teal-700" /> {t('import_title')}</h3>
                    <button className="rohy-subtle-button p-1.5 rounded" onClick={onClose}><X className="w-4 h-4" /></button>
                </div>

                <div className="px-5 pt-3">
                    <Steps step={step} labels={[t('step_upload'), t('step_map'), t('step_review'), t('step_done')]} />
                </div>

                <div className="p-5 overflow-y-auto flex-1">
                    {step === 1 && (
                        <div className="space-y-4">
                            <div className="grid md:grid-cols-2 gap-3">
                                <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-neutral-300 rounded-xl p-7 cursor-pointer hover:border-teal-400">
                                    <Upload className="w-7 h-7 text-neutral-400" />
                                    <span className="text-sm font-semibold">{t('choose_csv')}</span>
                                    <span className="text-xs text-neutral-500">{t('headers_auto_mapped')}</span>
                                    <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
                                </label>
                                <div className="border border-neutral-200 rounded-xl p-3 space-y-2">
                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                        <ClipboardPaste className="w-4 h-4 text-teal-700" /> {t('paste_csv')}
                                    </div>
                                    <textarea
                                        className="rohy-field w-full px-3 py-2 rounded-lg text-xs font-mono min-h-28"
                                        value={pasteText}
                                        onChange={e => setPasteText(e.target.value)}
                                        placeholder="username,name,email,password,role,class"
                                    />
                                    <button className="rohy-btn rohy-btn-secondary !text-xs" disabled={!pasteText.trim()} onClick={() => parseText(pasteText)}>
                                        {t('btn_parse_pasted')}
                                    </button>
                                </div>
                            </div>
                            <label className="block text-sm">
                                <span className="flex items-center gap-1.5 font-semibold mb-1">
                                    <GraduationCap className="w-4 h-4 text-teal-700" /> {t('label_default_course')}
                                </span>
                                <select className="rohy-field w-full px-2 py-1.5 rounded text-sm" value={cohortId} onChange={e => setCohortId(e.target.value)}>
                                    <option value="">{t('opt_use_csv_class')}</option>
                                    {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}{c.join_code ? t('opt_code_suffix', { code: c.join_code }) : ''}</option>)}
                                </select>
                            </label>
                            <div className="flex flex-wrap gap-2">
                                <button className="rohy-btn rohy-btn-ghost !text-xs" onClick={downloadTemplate}><Download className="w-3.5 h-3.5" /> {t('btn_download_template')}</button>
                                <span className="rohy-badge-neutral">{t('badge_supports_codes')}</span>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-4">
                            <p className="text-sm text-neutral-600">{t('map_instructions', { count: rawRows.length })}</p>
                            <div className="grid grid-cols-2 gap-3">
                                {FIELDS.map(f => (
                                    <label key={f} className="text-sm">
                                        <span className="block font-semibold mb-1">{t('field_' + f)}{(f === 'username' || f === 'email') && <span className="text-red-600"> *</span>}</span>
                                        <select className="rohy-field w-full px-2 py-1.5 rounded text-sm" value={mapping[f] || ''} onChange={e => setMapping(m => ({ ...m, [f]: e.target.value }))}>
                                            <option value="">{t('opt_ignore')}</option>
                                            {headers.map(h => <option key={h} value={h}>{h}</option>)}
                                        </select>
                                    </label>
                                ))}
                            </div>
                            <label className="block text-sm pt-2 border-t border-neutral-200">
                                <span className="block font-semibold mb-1">{t('label_enroll_all')}</span>
                                <select className="rohy-field w-full px-2 py-1.5 rounded text-sm" value={cohortId} onChange={e => setCohortId(e.target.value)}>
                                    <option value="">{t('opt_none_per_row')}</option>
                                    {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}{c.join_code ? t('opt_code_suffix', { code: c.join_code }) : ''}</option>)}
                                </select>
                            </label>
                            <div className="rohy-detail-panel rounded-lg p-3 text-sm">
                                <span className="font-semibold">{t('label_auto_assignment')}</span> {assignmentMode}
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-3">
                            <div className="flex flex-wrap gap-2 text-sm">
                                <Pill tone="green">{t('pill_new', { count: counts.create || 0 })}</Pill>
                                <Pill tone="teal">{t('pill_enroll', { count: counts.enroll || 0 })}</Pill>
                                <Pill tone="neutral">{t('pill_skip', { count: counts.skip || 0 })}</Pill>
                                <Pill tone="red">{t('pill_errors', { count: counts.error || 0 })}</Pill>
                            </div>
                            <div className="rohy-detail-panel rounded-lg p-3 text-sm">
                                <span className="font-semibold">{t('label_auto_assignment')}</span> {assignmentMode}
                            </div>
                            {serverPreview && (
                                <div className="rohy-detail-panel rounded-lg p-3 text-sm">
                                    <div className="font-semibold mb-1">{t('label_server_preview')}</div>
                                    <div className="flex flex-wrap gap-2">
                                        <Pill tone="green">{t('pill_create', { count: serverPreview.created.length })}</Pill>
                                        <Pill tone="teal">{t('pill_assign', { count: serverPreview.enrolled.length })}</Pill>
                                        <Pill tone="neutral">{t('pill_skip', { count: serverPreview.skipped.length })}</Pill>
                                        <Pill tone="red">{t('pill_fail', { count: serverPreview.failed.length })}</Pill>
                                    </div>
                                </div>
                            )}
                            <div className="rohy-table-shell rounded-lg overflow-hidden max-h-[40vh] overflow-y-auto">
                                <table className="w-full text-xs">
                                    <thead className="rohy-table-head sticky top-0"><tr>
                                        <th className="px-2 py-2 text-left">#</th><th className="px-2 py-2 text-left">{t('col_status')}</th>
                                        <th className="px-2 py-2 text-left">{t('col_username')}</th><th className="px-2 py-2 text-left">{t('col_email')}</th>
                                        <th className="px-2 py-2 text-left">{t('col_role')}</th><th className="px-2 py-2 text-left">{t('col_class')}</th>
                                        <th className="px-2 py-2 text-left">{t('col_notes')}</th>
                                    </tr></thead>
                                    <tbody>
                                        {validated.map(v => (
                                            <tr key={v.i} className="rohy-table-row">
                                                <td className="px-2 py-1.5 rohy-table-muted">{v.i + 1}</td>
                                                <td className="px-2 py-1.5"><StatusBadge status={v.status} t={t} /></td>
                                                <td className="px-2 py-1.5">{v.row.username || <em className="text-neutral-400">—</em>}</td>
                                                <td className="px-2 py-1.5 rohy-table-muted">{v.row.email}</td>
                                                <td className="px-2 py-1.5">{v.row.role || 'student'}</td>
                                                <td className="px-2 py-1.5">{v.row.class || (cohortId ? cohorts.find(c => String(c.id) === cohortId)?.name : '')}</td>
                                                <td className="px-2 py-1.5 text-red-600">
                                                    {[...v.errors, ...(serverPreview?.failed || []).filter(f => Number(f.row) === v.i + 1).map(f => f.error)].join(', ')}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {(counts.error || 0) > 0 && (
                                <button className="rohy-btn rohy-btn-ghost !text-xs" onClick={downloadErrors}><Download className="w-3.5 h-3.5" /> {t('btn_download_error_rows')}</button>
                            )}
                        </div>
                    )}

                    {step === 4 && result && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 text-teal-700"><CheckCircle2 className="w-6 h-6" /><span className="font-bold text-lg">{t('import_complete')}</span></div>
                            <div className="grid grid-cols-4 gap-2.5">
                                <Stat label={t('stat_created')} value={result.created.length} />
                                <Stat label={t('stat_enrolled')} value={result.enrolled.length} />
                                <Stat label={t('stat_skipped')} value={result.skipped.length} />
                                <Stat label={t('stat_failed')} value={result.failed.length} tone={result.failed.length ? 'warn' : undefined} />
                            </div>
                            {result.failed.length > 0 && (
                                <button className="rohy-btn rohy-btn-secondary !text-xs" onClick={downloadErrors}><Download className="w-3.5 h-3.5" /> {t('btn_download_error_report')}</button>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between px-5 py-4 border-t border-neutral-200">
                    <button className="rohy-btn rohy-btn-ghost" onClick={step > 1 && step < 4 ? () => setStep(step - 1) : onClose}>
                        {step > 1 && step < 4 ? <><ArrowLeft className="w-4 h-4" /> {t('btn_back')}</> : t('btn_close')}
                    </button>
                    {step === 2 && (
                        <button className="rohy-btn rohy-btn-primary" disabled={validating || !mapping.username || !mapping.email} onClick={reviewWithServer}>
                            {validating ? t('btn_validating') : t('btn_review')} <ArrowRight className="w-4 h-4" />
                        </button>
                    )}
                    {step === 3 && (
                        <button className="rohy-btn rohy-btn-primary" disabled={committing || commitRows.length === 0} onClick={commit}>
                            {committing ? t('btn_importing') : t('btn_import_rows', { count: commitRows.length })}
                        </button>
                    )}
                    {step === 4 && <button className="rohy-btn rohy-btn-primary" onClick={onDone}>{t('btn_done')}</button>}
                </div>
            </div>
        </div>
    );
}

function Steps({ step, labels }) {
    return (
        <div className="flex items-center gap-1.5">
            {labels.map((l, i) => (
                <div key={l} className="flex items-center gap-1.5">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full ${i + 1 === step ? 'rohy-badge-teal' : i + 1 < step ? 'rohy-badge-green' : 'rohy-badge-neutral'}`}>
                        {i + 1 < step ? <CheckCircle2 className="w-3 h-3" /> : <span>{i + 1}</span>} {l}
                    </span>
                    {i < labels.length - 1 && <span className="text-neutral-300">›</span>}
                </div>
            ))}
        </div>
    );
}
function StatusBadge({ status, t }) {
    const map = { create: 'rohy-badge-green', enroll: 'rohy-badge-teal', skip: 'rohy-badge-neutral', error: 'rohy-badge-red' };
    const label = { create: t('sb_new'), enroll: t('sb_enroll'), skip: t('sb_skip'), error: t('sb_error') };
    return <span className={map[status]}>{status === 'error' ? <AlertTriangle className="w-3 h-3 inline" /> : null} {label[status]}</span>;
}
function Pill({ tone, children }) {
    const map = { green: 'rohy-badge-green', teal: 'rohy-badge-teal', neutral: 'rohy-badge-neutral', red: 'rohy-badge-red' };
    return <span className={map[tone]}>{children}</span>;
}
function Stat({ label, value, tone }) {
    return (
        <div className="rohy-stat-card rounded-lg p-3 text-center">
            <div className={`text-xl font-bold ${tone === 'warn' ? 'text-amber-700' : ''}`}>{value}</div>
            <div className="text-xs text-neutral-600 uppercase tracking-wide font-semibold">{label}</div>
        </div>
    );
}

function csvCell(v) {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(filename, content) {
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
