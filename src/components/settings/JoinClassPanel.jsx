import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, ChevronDown, ChevronRight, FileText, GraduationCap, Loader2, Users } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { ApiError } from '../../services/apiClient';
import { joinCohort, getMyCohorts } from '../../services/cohortsService';
import TermsDocument from '../terms/TermsDocument';

// A course's optional agreement (licence, research information, course
// rules), shown read-only with the terms page's renderer. Informational only:
// Rohy records no acceptance — the teacher obtains any agreement needed,
// possibly outside Rohy.
function CourseAgreement({ agreement }) {
    const { t } = useTranslation('profile');
    const [open, setOpen] = useState(false);
    return (
        <div className="mt-2">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="text-xs text-blue-300 hover:text-blue-200 flex items-center gap-1"
            >
                {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                <FileText className="w-3.5 h-3.5" />
                {t('my_classes_agreement')}
            </button>
            {open && (
                <div
                    data-testid="learner-course-agreement"
                    className="mt-2 p-3 bg-neutral-900 border border-neutral-700 rounded-lg max-h-80 overflow-y-auto"
                >
                    {agreement.title && (
                        <h4 className="text-sm font-semibold text-neutral-100 mb-2">{agreement.title}</h4>
                    )}
                    <TermsDocument body={agreement.body} />
                </div>
            )}
        </div>
    );
}

// Minimal student self-join: enter a join code shared by a teacher.
// Lives inside UserProfilePanel so every user (incl. students) can reach it
// from the profile menu without a new top-level surface.
// Below the form, "My classes" lists the caller's live memberships
// (GET /cohorts/mine) and refreshes after a successful join, so joining a
// class is visibly confirmed instead of vanishing behind a toast.
export default function JoinClassPanel() {
    const { t, i18n } = useTranslation('profile');
    const toast = useToast();
    const [code, setCode] = useState('');
    const [submitting, setSubmitting] = useState(false);
    // null = still loading; [] = loaded and empty.
    const [classes, setClasses] = useState(null);
    const [listFailed, setListFailed] = useState(false);

    const loadClasses = useCallback(async () => {
        try {
            const data = await getMyCohorts();
            setClasses(Array.isArray(data?.cohorts) ? data.cohorts : []);
            setListFailed(false);
        } catch {
            setClasses([]);
            setListFailed(true);
        }
    }, []);

    useEffect(() => { loadClasses(); }, [loadClasses]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const joinCode = code.trim();
        if (!joinCode) return;
        setSubmitting(true);
        try {
            const data = await joinCohort(joinCode);
            const name = data?.cohort?.name || t('join_class_fallback_name');
            setCode('');
            toast.success(t('join_class_success', { name }));
            loadClasses();
        } catch (err) {
            const msg = err instanceof ApiError && err.message
                ? err.message
                : t('join_class_error');
            toast.error(msg);
        } finally {
            setSubmitting(false);
        }
    };

    // sqlite emits 'YYYY-MM-DD HH:MM:SS' (UTC, no zone marker); normalise to
    // ISO+Z so the Date is anchored correctly before locale formatting.
    const formatJoined = (value) => {
        if (!value) return null;
        const iso = String(value).replace(' ', 'T');
        const date = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
        return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(i18n.language);
    };

    return (
        <div className="space-y-6 max-w-md">
            <div className="p-4 bg-neutral-800/50 rounded-lg border border-neutral-700">
                <h3 className="text-sm font-bold text-neutral-300 mb-1 flex items-center gap-2">
                    <GraduationCap className="w-4 h-4" /> {t('join_class_title')}
                </h3>
                <p className="text-xs text-neutral-400">
                    {t('join_class_help')}
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-400" htmlFor="join-class-code">
                        {t('join_class_code_label')}
                    </label>
                    <input
                        id="join-class-code"
                        type="text"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder={t('join_class_code_placeholder')}
                        autoComplete="off"
                        className="w-full px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-white text-sm tracking-wider focus:outline-none focus:border-blue-500"
                    />
                </div>
                <button
                    type="submit"
                    disabled={submitting || !code.trim()}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-medium text-sm flex items-center gap-2 transition-colors"
                >
                    {submitting
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <GraduationCap className="w-4 h-4" />}
                    {t('join_class_button')}
                </button>
            </form>

            <div className="space-y-2">
                <h3 className="text-sm font-bold text-neutral-300 flex items-center gap-2">
                    <Users className="w-4 h-4" /> {t('my_classes_title')}
                </h3>
                {classes === null ? (
                    <div className="flex items-center gap-2 text-xs text-neutral-500">
                        <Loader2 className="w-4 h-4 animate-spin" /> {t('my_classes_loading')}
                    </div>
                ) : listFailed ? (
                    <p className="text-xs text-red-400">{t('my_classes_error')}</p>
                ) : classes.length === 0 ? (
                    <p className="text-xs text-neutral-500">{t('my_classes_empty')}</p>
                ) : (
                    <ul className="space-y-2">
                        {classes.map((cls) => {
                            const joined = formatJoined(cls.joined_at);
                            return (
                                <li
                                    key={cls.id}
                                    className="p-3 bg-neutral-800/50 border border-neutral-700 rounded-lg"
                                >
                                    <div className="text-sm font-medium text-white">{cls.name}</div>
                                    {cls.description && (
                                        <div className="text-xs text-neutral-400 mt-0.5">{cls.description}</div>
                                    )}
                                    {joined && (
                                        <div className="text-xs text-neutral-500 mt-1">
                                            {t('my_classes_joined', { date: joined })}
                                        </div>
                                    )}
                                    {cls.oyon_sensing_enabled && (
                                        <div className="text-xs text-neutral-400 mt-1 flex items-center gap-1">
                                            <Activity className="w-3.5 h-3.5" />
                                            {t('my_classes_oyon_on')}
                                        </div>
                                    )}
                                    {cls.agreement?.body && <CourseAgreement agreement={cls.agreement} />}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}
