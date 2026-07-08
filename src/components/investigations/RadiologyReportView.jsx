import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Building2, FileText, Maximize2, Pause, Play,
    Stethoscope, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { apiPut } from '../../services/apiClient';
import { usePatientRecord } from '../../services/PatientRecord';
import { formatDate, formatTime, formatDateTime } from '../../utils/formatters';

// Pure radiology-report content. Same content as the old
// RadiologyResultsModal — gradient header, study info bar, image viewer
// with zoom + fullscreen escape hatch, optional video, findings,
// impression, signature — but without the modal frame. Pass `onClose` to
// surface the X + Close buttons; omit it for embedded use inside
// InvestigationsScreen where the topbar's Back button is the canonical
// exit.
export default function RadiologyReportView({ result, patientInfo, onClose }) {
    const { t } = useTranslation('investigations');
    const { elicited } = usePatientRecord();
    const [imageZoom, setImageZoom] = useState(1);
    const [showFullImage, setShowFullImage] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const videoRef = useRef(null);

    const resultData = typeof result?.result_data === 'string'
        ? JSON.parse(result.result_data || '{}')
        : (result?.result_data || {});

    const accessionNumber = `RAD-${result?.id?.toString().padStart(6, '0') || '000001'}`;
    const reportDate = new Date(result?.available_at || Date.now());

    useEffect(() => {
        if (!result || result.viewed_at) return;
        apiPut(`/orders/${result.id}/view`, { room: 'radiology' }).catch((err) => {
            console.error('Failed to mark as viewed:', err);
        });
        const hasFindings = resultData.findings || resultData.interpretation;
        elicited('radiology', `${result.test_name}: ${resultData.interpretation || 'Results available'}`, hasFindings, {
            study_name: result.test_name,
            modality: result.modality,
            findings: resultData.findings,
            interpretation: resultData.interpretation,
            has_image: !!result.image_url,
        });
    }, [result?.id]);

    if (!result) return null;

    const hasImage = !!result.image_url;
    const hasVideo = !!resultData.videoUrl;
    const hasFindings = !!resultData.findings;
    const hasInterpretation = !!resultData.interpretation;

    const togglePlay = () => {
        if (!videoRef.current) return;
        if (videoRef.current.paused) videoRef.current.play();
        else videoRef.current.pause();
    };

    return (
        <>
            <div className="print-area bg-white rounded-lg w-full h-full flex flex-col shadow-2xl overflow-hidden" id="radiology-results-report">
                <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white p-6 print:bg-slate-800">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-4">
                            <div className="w-16 h-16 bg-white/10 rounded-lg flex items-center justify-center">
                                <Building2 className="w-8 h-8 text-cyan-400" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold tracking-wide">{t('radiology_report_title')}</h1>
                                <p className="text-cyan-400 text-sm font-medium mt-1">{t('medical_center')}</p>
                                <p className="text-slate-400 text-xs mt-0.5">{t('imaging_department')}</p>
                            </div>
                        </div>
                        {onClose && (
                            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors print:hidden">
                                <X className="w-6 h-6" />
                            </button>
                        )}
                    </div>
                </div>

                <div className="bg-slate-100 border-b border-slate-200 p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <div className="text-slate-500 text-xs uppercase tracking-wide">{t('patient')}</div>
                        <div className="font-semibold text-slate-800">{patientInfo?.name || t('unknown_patient')}</div>
                        <div className="text-slate-600 text-xs">
                            {patientInfo?.age && t('age_yo', { age: patientInfo.age })} {patientInfo?.gender}
                        </div>
                    </div>
                    <div>
                        <div className="text-slate-500 text-xs uppercase tracking-wide">{t('accession_number')}</div>
                        <div className="font-mono font-semibold text-slate-800">{accessionNumber}</div>
                    </div>
                    <div>
                        <div className="text-slate-500 text-xs uppercase tracking-wide">{t('study_date')}</div>
                        <div className="font-semibold text-slate-800">
                            {formatDate(reportDate, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                        <div className="text-slate-600 text-xs">
                            {formatTime(reportDate, { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    </div>
                    <div>
                        <div className="text-slate-500 text-xs uppercase tracking-wide">{t('status')}</div>
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                            {t('final')}
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    <div className="p-6 border-b border-slate-200">
                        <div className="flex items-start gap-4">
                            <div className="w-12 h-12 bg-cyan-100 rounded-lg flex items-center justify-center flex-shrink-0">
                                <FileText className="w-6 h-6 text-cyan-600" />
                            </div>
                            <div className="flex-1">
                                <h2 className="text-xl font-bold text-slate-800">{result.test_name}</h2>
                                <div className="flex items-center gap-3 mt-2 flex-wrap">
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                                        {result.modality || t('modality_imaging_fallback')}
                                    </span>
                                    {resultData.body_region && (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full text-xs">
                                            {resultData.body_region}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {hasImage && (
                        <div className="p-6 bg-black">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2 print:hidden">
                                    <button
                                        onClick={() => setImageZoom(z => Math.max(0.5, z - 0.25))}
                                        className="p-1.5 bg-white/10 hover:bg-white/20 rounded text-white"
                                    >
                                        <ZoomOut className="w-4 h-4" />
                                    </button>
                                    <span className="text-white/50 text-xs w-12 text-center">{Math.round(imageZoom * 100)}%</span>
                                    <button
                                        onClick={() => setImageZoom(z => Math.min(3, z + 0.25))}
                                        className="p-1.5 bg-white/10 hover:bg-white/20 rounded text-white"
                                    >
                                        <ZoomIn className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => setShowFullImage(true)}
                                        className="p-1.5 bg-white/10 hover:bg-white/20 rounded text-white ml-2"
                                    >
                                        <Maximize2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            <div className="overflow-auto max-h-[60vh] rounded-lg bg-black flex items-center justify-center">
                                <img
                                    src={result.image_url}
                                    alt={result.test_name}
                                    className="max-w-full transition-transform cursor-zoom-in"
                                    style={{ transform: `scale(${imageZoom})` }}
                                    onClick={() => setShowFullImage(true)}
                                />
                            </div>
                        </div>
                    )}

                    {hasVideo && (
                        <div className="p-6 bg-black print:hidden">
                            <div className="flex items-center justify-end mb-3">
                                <button
                                    onClick={togglePlay}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded text-white text-xs transition-colors"
                                >
                                    {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                                    {isPlaying ? t('pause') : t('play')}
                                </button>
                            </div>
                            <div className="rounded-lg overflow-hidden bg-neutral-900">
                                <video
                                    ref={videoRef}
                                    src={resultData.videoUrl}
                                    controls
                                    className="w-full max-h-96 cursor-pointer"
                                    controlsList="nodownload"
                                    onPlay={() => setIsPlaying(true)}
                                    onPause={() => setIsPlaying(false)}
                                    onEnded={() => setIsPlaying(false)}
                                    onClick={togglePlay}
                                >
                                    {t('video_not_supported')}
                                </video>
                            </div>
                        </div>
                    )}

                    <div className="p-6 space-y-6">
                        {resultData.indications && resultData.indications.length > 0 && (
                            <div>
                                <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">{t('clinical_indication')}</h3>
                                <p className="text-slate-700">{resultData.indications.slice(0, 3).join('; ')}</p>
                            </div>
                        )}

                        <div>
                            <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">{t('technique')}</h3>
                            <p className="text-slate-700">
                                {t('technique_body', {
                                    modality: result.modality ?? '',
                                    region: resultData.body_region || t('technique_region_fallback'),
                                })}
                            </p>
                        </div>

                        <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                            <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-3 flex items-center gap-2">
                                <Stethoscope className="w-4 h-4" />
                                {t('findings')}
                            </h3>
                            {hasFindings ? (
                                <p className="text-slate-800 leading-relaxed whitespace-pre-wrap">{resultData.findings}</p>
                            ) : (
                                <p className="text-slate-500 italic">
                                    {t('findings_default')}
                                </p>
                            )}
                        </div>

                        <div className="bg-cyan-50 rounded-lg p-4 border border-cyan-200">
                            <h3 className="text-xs uppercase tracking-wider text-cyan-700 font-semibold mb-3">{t('impression')}</h3>
                            {hasInterpretation ? (
                                <p className="text-slate-800 font-medium leading-relaxed whitespace-pre-wrap">{resultData.interpretation}</p>
                            ) : (
                                <p className="text-slate-800 font-medium">
                                    {t('impression_default_1')}<br />
                                    {t('impression_default_2')}
                                </p>
                            )}
                        </div>

                        <div className="pt-6 border-t border-slate-200 mt-8">
                            <div className="flex items-end justify-between">
                                <div>
                                    <div className="text-slate-800 font-semibold">{t('electronically_signed')}</div>
                                    <div className="text-slate-600 text-sm">
                                        {formatDateTime(reportDate, {
                                            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
                                            hour: '2-digit', minute: '2-digit',
                                        })}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="font-serif italic text-xl text-slate-700">{t('radiologist_name')}</div>
                                    <div className="text-slate-500 text-sm">{t('radiologist_credentials')}</div>
                                    <div className="text-slate-400 text-xs">{t('board_certified')}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-slate-100 border-t border-slate-200 p-4 flex items-center justify-between print:hidden">
                    <div className="text-xs text-slate-500">{t('radiology_disclaimer')}</div>
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-sm font-medium transition-colors"
                        >
                            {t('close')}
                        </button>
                    )}
                </div>
            </div>

            {showFullImage && hasImage && (
                <div className="fixed inset-0 bg-black z-[60] flex items-center justify-center" onClick={() => setShowFullImage(false)}>
                    <button
                        onClick={() => setShowFullImage(false)}
                        className="absolute top-4 right-4 p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                    >
                        <X className="w-6 h-6 text-white" />
                    </button>
                    <img
                        src={result.image_url}
                        alt={result.test_name}
                        className="max-w-[95vw] max-h-[95vh] object-contain"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </>
    );
}
