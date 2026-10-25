import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Eye, EyeOff, FileText, ShieldCheck } from 'lucide-react';
import TermsDocument from '../terms/TermsDocument';
import {
    COURSE_AGREEMENT_TITLE_MAX,
    COURSE_AGREEMENT_BODY_MAX_BYTES,
    agreementBodyBytes,
} from '../../../server/shared/courseSettings.js';

const INPUT =
    'w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500';

/**
 * The course form's "optional learning measures" switch and optional course
 * agreement (owner decision 2026-10-25). Controlled: the parent owns the three
 * values and merges them into settings with applyCourseFields()
 * (server/shared/courseSettings.js).
 *
 * The agreement is informational only — Rohy shows it to the course's
 * learners, never gates on it and never records acceptance. The preview uses
 * the terms page's renderer (TermsDocument) so the teacher sees exactly what
 * learners will see.
 */
export default function CourseMeasuresAgreementFields({
    sensing, onSensingChange,
    agreementTitle, onAgreementTitleChange,
    agreementBody, onAgreementBodyChange,
}) {
    const { t } = useTranslation('teacher_cohorts');
    const [preview, setPreview] = useState(false);
    const uid = useId();
    const sensingHintId = `${uid}-sensing-hint`;
    const titleId = `${uid}-agreement-title`;
    const bodyId = `${uid}-agreement-body`;
    const bodyBytes = agreementBodyBytes(agreementBody);
    const overLimit = bodyBytes > COURSE_AGREEMENT_BODY_MAX_BYTES;
    const hasBody = String(agreementBody || '').trim().length > 0;

    return (
        <section className="p-4 bg-neutral-800/50 border border-neutral-700 rounded-lg space-y-4">
            <h4 className="text-sm font-bold text-neutral-200 flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-purple-400" />
                {t('heading_measures_agreement')}
            </h4>

            <label className="flex items-start gap-2.5 text-sm text-neutral-200 cursor-pointer">
                <input
                    type="checkbox"
                    checked={Boolean(sensing)}
                    onChange={(e) => onSensingChange(e.target.checked)}
                    aria-describedby={sensingHintId}
                    className="w-4 h-4 mt-0.5 accent-purple-600"
                />
                <span>
                    {t('label_oyon_sensing')}
                    <span id={sensingHintId} className="block text-xs text-neutral-500">
                        {t('help_oyon_sensing')}
                    </span>
                </span>
            </label>

            <div className="space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
                    <FileText className="w-3.5 h-3.5" /> {t('label_course_agreement')}
                </div>
                <p className="text-xs text-neutral-500">{t('help_course_agreement')}</p>
                <div>
                    <label htmlFor={titleId} className="block text-xs font-medium text-neutral-300 mb-1.5">
                        {t('label_agreement_title')}
                    </label>
                    <input
                        id={titleId}
                        type="text"
                        value={agreementTitle}
                        maxLength={COURSE_AGREEMENT_TITLE_MAX}
                        onChange={(e) => onAgreementTitleChange(e.target.value)}
                        placeholder={t('placeholder_agreement_title')}
                        className={INPUT}
                    />
                </div>
                <div>
                    <label htmlFor={bodyId} className="block text-xs font-medium text-neutral-300 mb-1.5">
                        {t('label_agreement_body')}
                    </label>
                    <textarea
                        id={bodyId}
                        value={agreementBody}
                        onChange={(e) => onAgreementBodyChange(e.target.value)}
                        rows={6}
                        placeholder={t('placeholder_agreement_body')}
                        className={`${INPUT} resize-y font-mono`}
                    />
                    <p className={`text-xs mt-1 ${overLimit ? 'text-red-400' : 'text-neutral-500'}`}>
                        {overLimit
                            ? t('error_agreement_too_long', { max: COURSE_AGREEMENT_BODY_MAX_BYTES / 1024 })
                            : t('help_agreement_markdown')}
                    </p>
                </div>
                {hasBody && (
                    <button
                        type="button"
                        onClick={() => setPreview((v) => !v)}
                        aria-expanded={preview}
                        className="text-xs text-purple-300 hover:text-purple-200 flex items-center gap-1.5"
                    >
                        {preview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        {preview ? t('btn_hide_agreement_preview') : t('btn_show_agreement_preview')}
                    </button>
                )}
                {hasBody && preview && (
                    <div
                        data-testid="course-agreement-preview"
                        className="p-4 bg-neutral-900 border border-neutral-700 rounded-lg max-h-80 overflow-y-auto"
                    >
                        {agreementTitle.trim() && (
                            <h3 className="text-base font-semibold text-neutral-100 mb-2">{agreementTitle.trim()}</h3>
                        )}
                        <TermsDocument body={agreementBody} />
                    </div>
                )}
            </div>

            <p className="text-xs text-amber-200/80 flex items-start gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {t('notice_teacher_responsibility')}
            </p>
        </section>
    );
}
