import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Pause, Volume2, VolumeX, AlertTriangle, CheckCircle, Heart, Wind, Activity } from 'lucide-react';
import EventLogger from '../../services/eventLogger';
import { baseUrl } from '../../config/api';
import {
    PATIENT_FIGURE_HEIGHT,
    PATIENT_FIGURE_MASK,
    PATIENT_FIGURE_WIDTH
} from './patientFigure';

/**
 * Auscultation Panel - zoomed body view with audio playback.
 *
 * Region-aware (Bug 19, 18.5.2026): auscultating the abdomen previously
 * rendered the cardiac chest diagram, auto-played a heart sound and
 * labelled the player "Heart/Lung sounds". The panel now selects a
 * per-region PROFILE so the abdomen shows the four bowel-sound quadrants
 * plus the aortic/renal/femoral bruit points, and cardiopulmonary regions
 * keep their exact previous behaviour.
 */

// Default audio files for normal findings. `baseUrl(...)` prepends the
// SPA's deploy base (e.g. /rohy/ in production behind nginx) so the
// absolute path resolves to the same static directory Express serves
// `frontend/sounds/` from. Hardcoding the bare `/sounds/...` path
// bypasses the prefix and 404s on every `--base=/rohy/` deploy.
// There is no canned bowel-sound asset, so abdominal points have no
// default audio — the panel honestly shows "No audio available" unless
// the case author uploads a clip (which still flows via audioUrls/audioUrl).
const DEFAULT_SOUNDS = {
    heart: baseUrl('/sounds/normal-heart.mp3'),
    lung: baseUrl('/sounds/normal-lung.mp3')
};

// Cardiopulmonary auscultation points (percentage coordinates).
// type: 'heart' or 'lung' determines which default sound to use.
// `label`/`description` are the canonical English strings kept for
// EventLogger payloads; `labelKey`/`descKey` are the explicit i18n keys
// (namespace 'examination') used at every display site — the en values
// are byte-identical to label/description.
const CARDIO_POINTS = {
    aortic: { x: 54, y: 22, label: 'Aortic', description: '2nd ICS, right sternal border', labelKey: 'point_aortic', descKey: 'point_aortic_desc', type: 'heart' },
    pulmonic: { x: 46, y: 22, label: 'Pulmonic', description: '2nd ICS, left sternal border', labelKey: 'point_pulmonic', descKey: 'point_pulmonic_desc', type: 'heart' },
    erb: { x: 46, y: 30, label: "Erb's Point", description: '3rd ICS, left sternal border', labelKey: 'point_erb', descKey: 'point_erb_desc', type: 'heart' },
    tricuspid: { x: 50, y: 38, label: 'Tricuspid', description: '4th ICS, left sternal border', labelKey: 'point_tricuspid', descKey: 'point_tricuspid_desc', type: 'heart' },
    mitral: { x: 42, y: 42, label: 'Mitral (Apex)', description: '5th ICS, midclavicular line', labelKey: 'point_mitral', descKey: 'point_mitral_desc', type: 'heart' },
    lungLeft: { x: 35, y: 28, label: 'L. Lung', description: 'Left anterior chest', labelKey: 'point_lung_left', descKey: 'point_lung_left_desc', type: 'lung' },
    lungRight: { x: 65, y: 28, label: 'R. Lung', description: 'Right anterior chest', labelKey: 'point_lung_right', descKey: 'point_lung_right_desc', type: 'lung' },
    lungBaseLeft: { x: 38, y: 45, label: 'L. Base', description: 'Left lung base', labelKey: 'point_lung_base_left', descKey: 'point_lung_base_left_desc', type: 'lung' },
    lungBaseRight: { x: 62, y: 45, label: 'R. Base', description: 'Right lung base', labelKey: 'point_lung_base_right', descKey: 'point_lung_base_right_desc', type: 'lung' }
};

// Abdominal auscultation: four quadrants for bowel sounds + the three
// classic vascular bruit sites. Patient's right is on the viewer's left.
const ABDOMEN_POINTS = {
    ruq: { x: 38, y: 32, label: 'RUQ', description: 'Right upper quadrant — bowel sounds', labelKey: 'point_ruq', descKey: 'point_ruq_desc', type: 'bowel' },
    luq: { x: 62, y: 32, label: 'LUQ', description: 'Left upper quadrant — bowel sounds', labelKey: 'point_luq', descKey: 'point_luq_desc', type: 'bowel' },
    rlq: { x: 38, y: 62, label: 'RLQ', description: 'Right lower quadrant (ileocaecal) — bowel sounds', labelKey: 'point_rlq', descKey: 'point_rlq_desc', type: 'bowel' },
    llq: { x: 62, y: 62, label: 'LLQ', description: 'Left lower quadrant — bowel sounds', labelKey: 'point_llq', descKey: 'point_llq_desc', type: 'bowel' },
    aorticBruit: { x: 50, y: 40, label: 'Aorta', description: 'Epigastrium / midline — aortic bruit', labelKey: 'point_aorta', descKey: 'point_aorta_desc', type: 'bruit' },
    renalRight: { x: 40, y: 46, label: 'R. Renal', description: 'Para-umbilical right — renal artery bruit', labelKey: 'point_renal_right', descKey: 'point_renal_right_desc', type: 'bruit' },
    renalLeft: { x: 60, y: 46, label: 'L. Renal', description: 'Para-umbilical left — renal artery bruit', labelKey: 'point_renal_left', descKey: 'point_renal_left_desc', type: 'bruit' },
    femoralRight: { x: 40, y: 78, label: 'R. Femoral', description: 'Right groin — iliac/femoral bruit', labelKey: 'point_femoral_right', descKey: 'point_femoral_right_desc', type: 'bruit' },
    femoralLeft: { x: 60, y: 78, label: 'L. Femoral', description: 'Left groin — iliac/femoral bruit', labelKey: 'point_femoral_left', descKey: 'point_femoral_left_desc', type: 'bruit' }
};

// Visual + audio behaviour per point type.
const POINT_TYPE = {
    heart: { Icon: Heart, color: 'red' },
    lung: { Icon: Wind, color: 'cyan' },
    bowel: { Icon: Volume2, color: 'amber' },
    bruit: { Icon: Activity, color: 'violet' }
};

const ABDOMEN_KEYS = new Set(['abdomen', 'abdominal']);

// Profile resolution is data-driven first: the region may declare
// `auscultationProfile` in examRegions.js (the explicit, greppable
// contract). The lowercased name match is only a defensive fallback so a
// region that forgets the field still degrades to a best guess rather
// than silently to the chest diagram.
function getProfile(profileId, selectedRegion, regionName) {
    const explicit = String(profileId || '').toLowerCase();
    const key = String(selectedRegion || regionName || '').toLowerCase();
    if (explicit === 'abdomen' || (!explicit && ABDOMEN_KEYS.has(key))) {
        return {
            points: ABDOMEN_POINTS,
            // Bowel sounds are classically auscultated first; RLQ over the
            // ileocaecal valve is the conventional starting point.
            defaultPoint: 'rlq',
            playerLabelKey: 'sounds_bowel_bruit',
            renderBackground: () => (
                <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
                    {/* Abdominal wall outline */}
                    <rect x="22" y="18" width="56" height="68" rx="14"
                        fill="none" stroke="rgba(100,116,139,0.3)" strokeWidth="1" />
                    {/* Quadrant cross-lines through the umbilicus */}
                    <line x1="50" y1="20" x2="50" y2="84" stroke="rgba(100,116,139,0.2)" strokeWidth="0.5" />
                    <line x1="24" y1="48" x2="76" y2="48" stroke="rgba(100,116,139,0.2)" strokeWidth="0.5" />
                    {/* Umbilicus */}
                    <circle cx="50" cy="48" r="1.4" fill="rgba(100,116,139,0.35)" />
                </svg>
            )
        };
    }
    return {
        points: CARDIO_POINTS,
        // Mitral (apex) is clinically the most important first listen.
        defaultPoint: 'mitral',
        playerLabelKey: 'sounds_heart_lung',
        renderBackground: () => (
            <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
                {/* Simple chest outline */}
                <ellipse cx="50" cy="35" rx="35" ry="30" fill="none" stroke="rgba(100,116,139,0.3)" strokeWidth="1" />
                {/* Sternum line */}
                <line x1="50" y1="15" x2="50" y2="55" stroke="rgba(100,116,139,0.2)" strokeWidth="0.5" />
                {/* Rib lines */}
                {[20, 28, 36, 44].map((y, i) => (
                    <g key={i}>
                        <path d={`M 50 ${y} Q 35 ${y + 3} 25 ${y + 8}`} fill="none" stroke="rgba(100,116,139,0.15)" strokeWidth="0.5" />
                        <path d={`M 50 ${y} Q 65 ${y + 3} 75 ${y + 8}`} fill="none" stroke="rgba(100,116,139,0.15)" strokeWidth="0.5" />
                    </g>
                ))}
            </svg>
        )
    };
}

// Tailwind class fragments per point colour. Static strings so the
// Tailwind JIT keeps them (no dynamic `bg-${color}-500` interpolation).
const COLOR_CLASSES = {
    red: { sel: 'bg-red-500 ring-2 ring-red-400 ring-offset-1 ring-offset-slate-900 scale-125', idle: 'bg-red-600/80 hover:bg-red-500 hover:scale-110', ping: 'bg-red-400', text: 'text-red-300' },
    cyan: { sel: 'bg-cyan-500 ring-2 ring-cyan-400 ring-offset-1 ring-offset-slate-900 scale-125', idle: 'bg-cyan-600/80 hover:bg-cyan-500 hover:scale-110', ping: 'bg-cyan-400', text: 'text-cyan-300' },
    amber: { sel: 'bg-amber-500 ring-2 ring-amber-400 ring-offset-1 ring-offset-slate-900 scale-125', idle: 'bg-amber-600/80 hover:bg-amber-500 hover:scale-110', ping: 'bg-amber-400', text: 'text-amber-300' },
    violet: { sel: 'bg-violet-500 ring-2 ring-violet-400 ring-offset-1 ring-offset-slate-900 scale-125', idle: 'bg-violet-600/80 hover:bg-violet-500 hover:scale-110', ping: 'bg-violet-400', text: 'text-violet-300' }
};

// ——— Anatomical figure (additive, opt-in via `figure="manikin"`) ———
//
// The default background is a schematic ellipse. `figure="manikin"` draws
// the SAME ink-coverage patient Cardoyon's ECG lead selector uses (see
// patientFigure.js), painted through an SVG mask so the theme owns the
// colour, with dashed landmarks named the way a clinician names them. One
// body, one visual language, whichever room the learner is standing in.
//
// Coordinates live in that figure's 232x282 frame. Cardoyon measured the
// sternal midline at x=113 and the 4th/5th intercostal spaces at y=128/140;
// the auscultation sites below were measured against the same crop, so an
// intercostal space is 12 units and the umbilicus sits at (116, 180). Crops
// are square because the viewport is: with a non-square crop the SVG's slice
// fit would quietly shave the narrower axis, landmark labels included.
// Laterality is the standard anterior view: the patient's RIGHT is on the
// viewer's LEFT (x < 113).
const MANIKIN_FIGURES = {
    cardio: {
        crop: { x0: 70, y0: 78, x1: 162, y1: 170 },
        landmarks: {
            midline: 113,
            spaces: [
                { y: 104, label: '2nd' },
                { y: 128, label: '4th' },
                { y: 140, label: '5th' }
            ]
        },
        points: {
            aortic: { x: 105, y: 104, code: 'Ao' },
            pulmonic: { x: 121, y: 104, code: 'P' },
            erb: { x: 121, y: 116, code: 'E' },
            tricuspid: { x: 121, y: 128, code: 'T' },
            mitral: { x: 137, y: 141, code: 'M' },
            lungLeft: { x: 142, y: 108, code: 'LL' },
            lungRight: { x: 92, y: 108, code: 'RL' },
            lungBaseLeft: { x: 144, y: 152, code: 'LB' },
            lungBaseRight: { x: 90, y: 152, code: 'RB' }
        }
    },
    abdomen: {
        crop: { x0: 72, y0: 148, x1: 160, y1: 236 },
        landmarks: { midline: 113, spaces: [] },
        points: {
            ruq: { x: 100, y: 165, code: 'RUQ' },
            luq: { x: 132, y: 165, code: 'LUQ' },
            rlq: { x: 100, y: 197, code: 'RLQ' },
            llq: { x: 132, y: 197, code: 'LLQ' },
            aorticBruit: { x: 116, y: 160, code: 'Ao' },
            renalRight: { x: 104, y: 180, code: 'RR' },
            renalLeft: { x: 128, y: 180, code: 'LR' },
            femoralRight: { x: 99, y: 222, code: 'RF' },
            femoralLeft: { x: 133, y: 222, code: 'LF' }
        }
    }
};

// Map a point from the figure's frame into percentages of the cropped
// viewport, so the same coordinates work at any panel size.
function cropPercent(crop, point) {
    return {
        left: ((point.x - crop.x0) / (crop.x1 - crop.x0)) * 100,
        top: ((point.y - crop.y0) / (crop.y1 - crop.y0)) * 100
    };
}

export default function AuscultationPanel({
    finding,
    isAbnormal,
    audioUrl,          // Single audio for the whole region (legacy support)
    audioUrls = {},    // Multiple audio files for different points { pointId: url }
    heartAudio,        // Custom heart sound (overrides default for all heart points)
    lungAudio,         // Custom lung sound (overrides default for all lung points)
    selectedRegion,        // Region key — fallback profile heuristic
    auscultationProfile,   // Explicit profile id from examRegions.js (preferred)
    regionName = 'Chest',
    figure = 'diagram',    // 'diagram' (default) | 'manikin' (anatomical)
    layout = 'row',        // 'row' (default) | 'stack' for narrow panels
    transport = 'default', // 'default' | 'compact' (tiny play + seek)
    normalLabel = true,    // false hides the "normal" verdict badge
    chrome = 'card'        // 'card' (default) | 'bare' — host owns the frame
}) {
    const { t } = useTranslation('examination');
    const profile = getProfile(auscultationProfile, selectedRegion, regionName);
    const POINTS = profile.points;
    // The manikin figure only applies where anatomical coordinates exist for
    // the active profile; anything else falls back to the schematic diagram.
    const figureKey = POINTS === ABDOMEN_POINTS ? 'abdomen' : 'cardio';
    const manikin = figure === 'manikin' ? MANIKIN_FIGURES[figureKey] : null;
    // The crop is magnified into a 280px box, so Cardoyon's pixel-sized
    // landmark strokes and labels have to be divided by that magnification
    // or they scale up into the picture instead of orienting it.
    const figureUnit = manikin ? (manikin.crop.x1 - manikin.crop.x0) / 280 : 1;
    const stacked = layout === 'stack';
    const bare = chrome === 'bare';
    const pointPosition = (id, point) => {
        const anatomical = manikin?.points[id];
        return anatomical
            ? cropPercent(manikin.crop, anatomical)
            : { left: point.x, top: point.y };
    };

    const [selectedPoint, setSelectedPoint] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    // Real playback position: the progress bar used to be hardcoded to 60%
    // with a pulse, which told the learner nothing about the recording.
    const [playedSeconds, setPlayedSeconds] = useState(0);
    const [clipSeconds, setClipSeconds] = useState(0);
    const [isMuted, setIsMuted] = useState(false);
    // A ref, not state: React's dev double-invocation of effects ran the
    // auto-play (and its analytics row) twice before the state update
    // landed. A ref flips synchronously inside the first run.
    const hasAutoPlayedRef = useRef(false);
    const audioRef = useRef(null);

    const playedFraction = clipSeconds > 0 ? Math.min(playedSeconds / clipSeconds, 1) : 0;
    const clock = (seconds) => (Number.isFinite(seconds) && seconds >= 0
        ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
        : '0:00');
    const seekTo = (seconds) => {
        if (!audioRef.current) return;
        audioRef.current.currentTime = seconds;
        setPlayedSeconds(seconds);
    };

    // Normalise any audio URL to the SPA's deploy base. Uploaded audio
    // arrives as either `./uploads/foo.mp3` (legacy relative) or
    // `/uploads/foo.mp3` (absolute) — both get rewritten to
    // `<base>/uploads/foo.mp3`, which is what Express actually serves
    // once nginx strips the `/rohy/` prefix. Already-absolute http(s)
    // URLs pass through unchanged.
    const resolveAudio = (url) => {
        if (!url) return null;
        if (/^https?:\/\//i.test(url)) return url;
        // Strip any leading `./` so baseUrl() doesn't emit `/rohy/./uploads/...`
        const trimmed = url.replace(/^\.\//, '');
        return baseUrl(trimmed.startsWith('/') ? trimmed : '/' + trimmed);
    };

    // Get the appropriate audio URL for a point
    const getAudioForPoint = (pointId) => {
        // Priority: specific point audio > type-specific audio > general audio > default
        if (audioUrls[pointId]) return resolveAudio(audioUrls[pointId]);

        const point = POINTS[pointId];
        if (point) {
            if (point.type === 'heart' && heartAudio) return resolveAudio(heartAudio);
            if (point.type === 'lung' && lungAudio) return resolveAudio(lungAudio);
            // Use canned defaults for normal findings where one exists
            // (heart/lung only — bowel/bruit have no default asset).
            if (!isAbnormal && DEFAULT_SOUNDS[point.type]) {
                return DEFAULT_SOUNDS[point.type];
            }
        }

        return resolveAudio(audioUrl);
    };

    const handlePointClick = (pointId) => {
        // Stop current audio
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
        setSelectedPoint(pointId);
        setIsPlaying(false);

        // Get point info for logging
        const point = POINTS[pointId];
        const audioSrc = getAudioForPoint(pointId);
        const hasAudio = !!audioSrc;

        // Log auscultation event with audio URL
        EventLogger.auscultationPerformed(
            point?.label || pointId,
            point?.type || 'unknown',
            finding || 'No finding',
            hasAudio,
            audioSrc
        );

        // Auto-play the new point's audio
        if (audioSrc && audioRef.current) {
            audioRef.current.src = audioSrc;
            audioRef.current.load();
            audioRef.current.play().then(() => {
                setIsPlaying(true);
            }).catch(err => {
                console.log('Autoplay prevented:', err);
            });
        }
    };

    // Auto-select the profile's first point and play on mount
    useEffect(() => {
        if (!hasAutoPlayedRef.current && audioRef.current) {
            hasAutoPlayedRef.current = true;
            const defaultPoint = profile.defaultPoint;
            setSelectedPoint(defaultPoint);

            const audioSrc = getAudioForPoint(defaultPoint);
            if (audioSrc) {
                audioRef.current.src = audioSrc;
                audioRef.current.load();
                audioRef.current.play().then(() => {
                    setIsPlaying(true);
                }).catch(err => {
                    console.log('Autoplay prevented:', err);
                });
            }

            // Log the auto-played auscultation with audio URL
            const point = POINTS[defaultPoint];
            EventLogger.auscultationPerformed(
                point?.label || defaultPoint,
                point?.type || 'unknown',
                finding || 'No finding',
                !!audioSrc,
                audioSrc
            );
        }
    }, [finding]);

    // Update audio source when point changes (for prop changes)
    useEffect(() => {
        if (audioRef.current && selectedPoint) {
            const newSrc = getAudioForPoint(selectedPoint);
            if (newSrc && !audioRef.current.src.endsWith(newSrc.split('/').pop())) {
                audioRef.current.src = newSrc;
                audioRef.current.load();
            }
        }
    }, [audioUrls, heartAudio, lungAudio]);

    const togglePlay = () => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
            } else {
                audioRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const toggleMute = () => {
        if (audioRef.current) {
            audioRef.current.muted = !isMuted;
            setIsMuted(!isMuted);
        }
    };

    const currentAudioUrl = selectedPoint ? getAudioForPoint(selectedPoint) : null;
    const currentPoint = selectedPoint ? POINTS[selectedPoint] : null;
    const currentMeta = currentPoint ? (POINT_TYPE[currentPoint.type] || POINT_TYPE.heart) : null;

    return (
        <div className={bare
            ? ''
            : `rounded-lg border p-4 ${isAbnormal ? 'bg-red-950/30 border-red-800' : 'bg-slate-800/50 border-slate-700'}`}>
            {/* Header. Hidden when the host frames this panel itself and has
                already named the region and technique above it. */}
            <div className={`flex items-center justify-between mb-3${bare ? ' hidden' : ''}`}>
                <div className="flex items-center gap-2">
                    <Volume2 className="w-5 h-5 text-cyan-400" />
                    <span className="text-white font-medium">{t('auscultation_title', { region: regionName })}</span>
                </div>
                {/* An abnormal finding is flagged because it is safety
                    relevant. "Normal" is withheld where the host asks
                    (normalLabel={false}): naming the verdict does the
                    learner's interpretation for them. */}
                {isAbnormal ? (
                    <span className="flex items-center gap-1 text-xs px-2 py-1 bg-red-900/50 text-red-400 rounded">
                        <AlertTriangle className="w-3 h-3" />
                        {t('abnormal')}
                    </span>
                ) : normalLabel ? (
                    <span className="flex items-center gap-1 text-xs px-2 py-1 bg-emerald-900/50 text-emerald-400 rounded">
                        <CheckCircle className="w-3 h-3" />
                        {t('normal')}
                    </span>
                ) : null}
            </div>

            {/* Side by side needs ~600px; in a docked panel that squeezes the
                finding into a 3-words-per-line ribbon, so narrow hosts ask for
                'stack' and the figure sits above its text at full width. */}
            <div className={stacked ? 'flex flex-col gap-4' : 'flex gap-4'}>
                {/* Zoomed body view */}
                <div
                    className={`relative rounded-lg overflow-hidden ${manikin ? 'bg-slate-950' : 'bg-slate-900'} ${
                        stacked ? 'mx-auto aspect-square w-full max-w-[280px]' : ''
                    }`}
                    style={stacked ? undefined : { width: '280px', height: '280px' }}
                >
                    {manikin ? (
                        // The patient as ink coverage, painted through a mask
                        // so the panel's own colour carries it — Cardoyon's
                        // treatment, on Cardoyon's figure, in its own frame.
                        <svg
                            className="absolute inset-0 h-full w-full"
                            viewBox={`${manikin.crop.x0} ${manikin.crop.y0} ${manikin.crop.x1 - manikin.crop.x0} ${manikin.crop.y1 - manikin.crop.y0}`}
                            preserveAspectRatio="xMidYMid slice"
                            aria-hidden="true"
                        >
                            <defs>
                                <mask id={`exam-figure-${figureKey}`} maskUnits="userSpaceOnUse"
                                    x="0" y="0" width={PATIENT_FIGURE_WIDTH} height={PATIENT_FIGURE_HEIGHT}>
                                    <image href={PATIENT_FIGURE_MASK} x="0" y="0"
                                        width={PATIENT_FIGURE_WIDTH} height={PATIENT_FIGURE_HEIGHT} />
                                </mask>
                            </defs>
                            <rect x="0" y="0" width={PATIENT_FIGURE_WIDTH} height={PATIENT_FIGURE_HEIGHT}
                                fill="#9db4cb" mask={`url(#exam-figure-${figureKey})`} />
                            {/* Landmarks a clinician would find by hand,
                                drawn faintly so they orient the sites
                                without becoming the picture. */}
                            <line
                                x1={manikin.landmarks.midline} y1={manikin.crop.y0 + 6}
                                x2={manikin.landmarks.midline} y2={manikin.crop.y1 - 6}
                                stroke="rgba(151,176,203,.3)"
                                strokeWidth={figureUnit}
                                strokeDasharray={`${4 * figureUnit} ${3.4 * figureUnit}`}
                            />
                            {manikin.landmarks.spaces.map((space) => (
                                <g key={space.label}>
                                    <line
                                        x1={manikin.crop.x0 + 9} y1={space.y}
                                        x2={manikin.crop.x1 - 2} y2={space.y}
                                        stroke="rgba(151,176,203,.3)"
                                        strokeWidth={figureUnit}
                                        strokeDasharray={`${4 * figureUnit} ${3.4 * figureUnit}`}
                                    />
                                    <text
                                        x={manikin.crop.x0 + 1.5}
                                        y={space.y + 1 * figureUnit}
                                        fill="rgba(151,176,203,.55)"
                                        style={{ font: `600 ${7 * figureUnit}px ui-monospace, monospace` }}
                                        textAnchor="start"
                                    >
                                        {space.label}
                                    </text>
                                </g>
                            ))}
                        </svg>
                    ) : profile.renderBackground()}

                    {/* Auscultation points */}
                    {Object.entries(POINTS).map(([id, point]) => {
                        const pointHasAudio = !!getAudioForPoint(id);
                        const isSelected = selectedPoint === id;
                        const meta = POINT_TYPE[point.type] || POINT_TYPE.heart;
                        const PointIcon = meta.Icon;
                        const cc = COLOR_CLASSES[meta.color];
                        // On the manikin the sites are read as targets on a
                        // body, so they follow the lead-map's restraint: a
                        // small ringed dot with its clinical shorthand, teal
                        // only where the reader is actually listening.
                        const code = manikin?.points[id]?.code;
                        return (
                            <button
                                key={id}
                                onClick={() => handlePointClick(id)}
                                className={manikin
                                    ? `absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border font-mono text-[9px] font-bold transition-all ${
                                        isSelected
                                            ? 'border-teal-200 bg-teal-400 text-teal-950 scale-110'
                                            : pointHasAudio
                                            ? 'border-slate-400/50 bg-slate-950/60 text-slate-300 hover:border-teal-300 hover:bg-slate-800'
                                            : 'border-slate-600/40 border-dashed bg-slate-950/40 text-slate-500'
                                    }`
                                    : `absolute w-7 h-7 rounded-full transform -translate-x-1/2 -translate-y-1/2 transition-all flex items-center justify-center cursor-pointer ${
                                        isSelected
                                            ? cc.sel
                                            : pointHasAudio
                                            ? cc.idle
                                            : 'bg-slate-600 hover:bg-slate-500'
                                    }`}
                                style={{
                                    left: `${pointPosition(id, point).left}%`,
                                    top: `${pointPosition(id, point).top}%`
                                }}
                                title={t('point_tooltip', { label: t(point.labelKey), description: t(point.descKey) })}
                            >
                                {manikin
                                    ? code
                                    : <PointIcon className="w-3.5 h-3.5 text-white" />}
                                {isSelected && !manikin && (
                                    <span className={`absolute inset-0 rounded-full animate-ping opacity-50 ${cc.ping}`} />
                                )}
                            </button>
                        );
                    })}

                    {/* Point label */}
                    {currentPoint && currentMeta && (
                        <div className="absolute bottom-1 left-1 right-1 bg-black/70 rounded px-2 py-1 text-center">
                            <div className={`text-xs font-medium flex items-center justify-center gap-1 ${COLOR_CLASSES[currentMeta.color].text}`}>
                                <currentMeta.Icon className="w-3 h-3" />
                                {t(currentPoint.labelKey)}
                            </div>
                            <div className="text-[10px] text-slate-400">{t(currentPoint.descKey)}</div>
                        </div>
                    )}
                </div>

                {/* Outside the layout branches: switching between docked and
                    fullscreen must not remount this and cut the sound off. */}
                <audio
                    ref={audioRef}
                    onTimeUpdate={(event) => setPlayedSeconds(event.currentTarget.currentTime)}
                    onLoadedMetadata={(event) => {
                        const { duration } = event.currentTarget;
                        setClipSeconds(Number.isFinite(duration) ? duration : 0);
                        setPlayedSeconds(0);
                    }}
                    onEnded={() => {
                        setIsPlaying(false);
                        setPlayedSeconds(0);
                    }}
                    onError={() => console.error('Audio failed to load')}
                />

                {/* Stacked panels read top-down: the body, the controls
                    for the site just clicked on it, then the finding it
                    produced. Side by side keeps the finding leading its
                    own column with the player beneath. */}
                {stacked ? (
                    <>
                            {/* Audio Player. The compact transport is one line —
                            tiny play, a real seek bar, elapsed/length — for
                            panels that cannot spare a 40px control block. */}
                        {currentAudioUrl && transport === 'compact' ? (
                            <div className="rounded-lg bg-slate-900 px-2 py-1.5">
                                <div className="mb-1 truncate px-1 text-[10px] text-slate-400">
                                    {currentPoint ? t('point_sounds', { point: t(currentPoint.labelKey) }) : t(profile.playerLabelKey)}
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={togglePlay}
                                        aria-label={isPlaying ? 'Pause' : 'Play'}
                                        className="grid h-7 w-7 flex-none place-items-center rounded-full bg-cyan-600 transition-colors hover:bg-cyan-500"
                                    >
                                        {isPlaying
                                            ? <Pause className="h-3.5 w-3.5 text-white" />
                                            : <Play className="ml-0.5 h-3.5 w-3.5 text-white" />}
                                    </button>
                                    <span className="flex-none font-mono text-[10px] tabular-nums text-slate-400">
                                        {clock(playedSeconds)}
                                    </span>
                                    <input
                                        type="range"
                                        min="0"
                                        max={clipSeconds || 0}
                                        step="0.05"
                                        value={Math.min(playedSeconds, clipSeconds || 0)}
                                        onChange={(event) => seekTo(Number(event.target.value))}
                                        aria-label="Seek"
                                        className="h-1 min-w-0 flex-1 cursor-pointer accent-cyan-500"
                                    />
                                    <span className="flex-none font-mono text-[10px] tabular-nums text-slate-500">
                                        {clock(clipSeconds)}
                                    </span>
                                    <button
                                        onClick={toggleMute}
                                        aria-label={isMuted ? 'Unmute' : 'Mute'}
                                        className="flex-none p-1 text-slate-400 hover:text-white"
                                    >
                                        {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                                    </button>
                                </div>
                            </div>
                        ) : currentAudioUrl ? (
                            <div className="bg-slate-900 rounded-lg p-3">
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={togglePlay}
                                        className="w-10 h-10 rounded-full bg-cyan-600 hover:bg-cyan-500 flex items-center justify-center transition-colors"
                                    >
                                        {isPlaying ? (
                                            <Pause className="w-5 h-5 text-white" />
                                        ) : (
                                            <Play className="w-5 h-5 text-white ml-0.5" />
                                        )}
                                    </button>
                                    <div className="flex-1">
                                        <div className="text-xs text-slate-400 mb-1">
                                            {currentPoint ? t('point_sounds', { point: t(currentPoint.labelKey) }) : t(profile.playerLabelKey)}
                                        </div>
                                        <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-cyan-500 transition-all"
                                                style={{ width: `${playedFraction * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={toggleMute}
                                        className="p-2 text-slate-400 hover:text-white"
                                    >
                                        {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-slate-900/50 rounded-lg p-3 text-center text-slate-500 text-xs">
                                {t('no_audio')}
                            </div>
                        )}
                            {/* Finding text */}
                        <div className={`flex-1 text-sm leading-relaxed p-3 rounded bg-slate-900/50 mb-3 ${isAbnormal ? 'text-red-200' : 'text-slate-200'}`}>
                            {finding || t('auscultate_prompt')}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col">
                    {/* Finding text */}
                    <div className={`flex-1 text-sm leading-relaxed p-3 rounded bg-slate-900/50 mb-3 ${isAbnormal ? 'text-red-200' : 'text-slate-200'}`}>
                        {finding || t('auscultate_prompt')}
                    </div>

                    {/* Audio Player. The compact transport is one line —
                        tiny play, a real seek bar, elapsed/length — for
                        panels that cannot spare a 40px control block. */}
                    {currentAudioUrl && transport === 'compact' ? (
                        <div className="rounded-lg bg-slate-900 px-2 py-1.5">
                            <div className="mb-1 truncate px-1 text-[10px] text-slate-400">
                                {currentPoint ? t('point_sounds', { point: t(currentPoint.labelKey) }) : t(profile.playerLabelKey)}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={togglePlay}
                                    aria-label={isPlaying ? 'Pause' : 'Play'}
                                    className="grid h-7 w-7 flex-none place-items-center rounded-full bg-cyan-600 transition-colors hover:bg-cyan-500"
                                >
                                    {isPlaying
                                        ? <Pause className="h-3.5 w-3.5 text-white" />
                                        : <Play className="ml-0.5 h-3.5 w-3.5 text-white" />}
                                </button>
                                <span className="flex-none font-mono text-[10px] tabular-nums text-slate-400">
                                    {clock(playedSeconds)}
                                </span>
                                <input
                                    type="range"
                                    min="0"
                                    max={clipSeconds || 0}
                                    step="0.05"
                                    value={Math.min(playedSeconds, clipSeconds || 0)}
                                    onChange={(event) => seekTo(Number(event.target.value))}
                                    aria-label="Seek"
                                    className="h-1 min-w-0 flex-1 cursor-pointer accent-cyan-500"
                                />
                                <span className="flex-none font-mono text-[10px] tabular-nums text-slate-500">
                                    {clock(clipSeconds)}
                                </span>
                                <button
                                    onClick={toggleMute}
                                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                                    className="flex-none p-1 text-slate-400 hover:text-white"
                                >
                                    {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                                </button>
                            </div>
                        </div>
                    ) : currentAudioUrl ? (
                        <div className="bg-slate-900 rounded-lg p-3">
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={togglePlay}
                                    className="w-10 h-10 rounded-full bg-cyan-600 hover:bg-cyan-500 flex items-center justify-center transition-colors"
                                >
                                    {isPlaying ? (
                                        <Pause className="w-5 h-5 text-white" />
                                    ) : (
                                        <Play className="w-5 h-5 text-white ml-0.5" />
                                    )}
                                </button>
                                <div className="flex-1">
                                    <div className="text-xs text-slate-400 mb-1">
                                        {currentPoint ? t('point_sounds', { point: t(currentPoint.labelKey) }) : t(profile.playerLabelKey)}
                                    </div>
                                    <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-cyan-500 transition-all"
                                            style={{ width: `${playedFraction * 100}%` }}
                                        />
                                    </div>
                                </div>
                                <button
                                    onClick={toggleMute}
                                    className="p-2 text-slate-400 hover:text-white"
                                >
                                    {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-slate-900/50 rounded-lg p-3 text-center text-slate-500 text-xs">
                            {t('no_audio')}
                        </div>
                    )}
                    </div>
                )}
            </div>

            {/* Auscultation point legend */}
            <div className="mt-3 pt-3 border-t border-slate-700">
                <div className="text-xs text-slate-500 mb-2">{t('legend_click_points')}</div>
                <div className="flex flex-wrap gap-2">
                    {Object.entries(POINTS).map(([id, point]) => (
                        <button
                            key={id}
                            onClick={() => handlePointClick(id)}
                            className={`px-2 py-0.5 rounded text-xs transition-colors ${
                                selectedPoint === id
                                    ? 'bg-cyan-600 text-white'
                                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                            }`}
                        >
                            {t(point.labelKey)}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
