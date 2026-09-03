import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Map, Volume2, VolumeX } from 'lucide-react';
import { mountPatientRoom } from 'rohy-3d-patient-room';
import EventLogger from '../../services/eventLogger';
import { casePatient, mapVitals, rhythmLabel } from './caseBinding.js';
import { startEcgMirror } from './ecgMirror.js';
import { SUPINE_REGIONS_3D } from './examRegions3d.js';
import { supineRegionsWithExams } from './examWheelData.js';
import usePhysicalExam from '../../hooks/usePhysicalExam';
import ManikinOverlay from './ManikinOverlay.jsx';
import FindingPanel from './FindingPanel.jsx';
import usePatientVoice from './usePatientVoice.js';
import usePatientTemplate from './usePatientTemplate.js';
import usePatientAvatar from './usePatientAvatar.js';
import useRoomConversation from './useRoomConversation.js';
import SubtitleBand from '../../components/voice/SubtitleBand';
import { useSubtitleReveal } from '../../components/voice/useSubtitleReveal';
import VoiceControl from '../../components/discussion/VoiceControl';
import { useVoice } from '../../contexts/VoiceContext';
import { VoiceService } from '../../services/voiceService';
import { sttLocaleFor, DEFAULT_LANGUAGE } from '../../i18n/languages';

// The exam3d room surface: a full-screen 3D patient room bound to live Rohy
// data. The active case supplies the patient record and avatar; the monitor
// mirrors EventLogger.currentVitals and the real ECG generator; the 3D
// objects open Rohy's own surfaces — the chart opens the OrdersDrawer
// records tab, the IV pole and oxygen station its treatments tab — via
// onOpenDrawer. No clinical UI is re-implemented here.
//
// Physical examination is diegetic: clicking the patient's body blooms the
// room's radial exam wheel, whose wedges are the region's REAL techniques
// from Rohy's exam model (examWheelData). Each wedge performs the exam via
// the SAME usePhysicalExam hook the 2D examination room performs
// through — one implementation, so the two rooms cannot drift.
//
// The finding is presented by Rohy, not by the room: the room mounts with
// findings: 'host', so it keeps the wheel, the region tint and the wince,
// while FindingPanel renders the result through Rohy's own FindingDisplay
// — which means auscultation keeps its full AuscultationPanel (clickable
// chest/abdomen points, per-point audio, play/pause, volume). Rohy's real
// ManikinPanel — the stylized examination figure with its front/back views
// — opens full size behind the "Body map" pill, so regions a supine
// anterior view hides are never lost.
//
// z-order contract: this surface sits at z-30, BELOW the fixed RoomNavigator
// (z-40, the exit affordance — there is no Back button, matching the other
// rooms) and the OrdersDrawer (z-50), whose backdrop dims the room.
//
// Vitals bridge: Rohy's physiology runs client-side inside PatientMonitor,
// which lives in the chat layout. App keeps that layout mounted (hidden and
// inert) underneath this surface so EventLogger.currentVitals stays live.
// Room stamping is App's existing roomChanged effect on currentRoom — this
// component does not stamp rooms itself.

// Destinations on the room's navigation wheel, beside the camera views.
// "examine" is answered by the room itself (it opens the examination
// wheel); the rest arrive here as nav events.
// Labels come from the `room3d` namespace, so the wheel reads in the
// session's language like the rest of the navigator.
const navActions = (tRoom) => [
    { id: 'examine', label: tRoom('nav_examine'), hint: tRoom('nav_examine_hint'), color: '#7ee0c0' },
    { id: 'records', label: tRoom('nav_records'), hint: tRoom('nav_records_hint'), color: '#ffb84a' },
    { id: 'bodymap', label: tRoom('nav_bodymap'), hint: tRoom('nav_bodymap_hint'), color: '#b18cff' },
];

// The patient answers an abnormal discovery out loud; the room itself
// already winces and tints the region. Spoken lines are translated: the
// case's voice speaks the case's language, and an English sentence in a
// Finnish patient's mouth was the loudest untranslated string in the app.
// The package renders its own chrome (clock, monitor, wheels, finding
// card); it takes every string it shows as a `labels` override, keyed by
// the package's DEFAULT_LABELS. These are the same keys with a `chrome_`
// prefix in the room3d namespace.
const CHROME_LABEL_KEYS = [
    'case_time', 'live_monitor', 'ecg_lead', 'rhythm_sinus', 'rhythm_sinus_tach', 'last_reading',
    'view_trends', 'trends_title', 'trends_close', 'trends_note_live', 'view_hub', 'choose_view',
    'open_view_menu', 'move', 'nudge_group', 'nudge_head', 'nudge_left', 'nudge_right', 'nudge_foot',
    'status_critical', 'status_unstable', 'status_stabilizing', 'status_stable',
    'copy_critical', 'copy_unstable', 'copy_stabilizing', 'copy_stable',
    'view_overview', 'view_overview_hint', 'view_patient', 'view_patient_hint', 'view_airway',
    'view_airway_hint', 'view_monitor', 'view_monitor_hint', 'view_equipment', 'view_equipment_hint',
    'finding_close', 'unavailable_title', 'unavailable_body', 'reduced_visuals', 'reduced_visuals_live',
    'scenario_time', 'live_vitals', 'room', 'ecg_aria', 'camera_views',
];
export const chromeLabels = (t) => Object.fromEntries(CHROME_LABEL_KEYS.map((key) => [key, t(`chrome_${key}`)]));

const REACTION_KEYS = {
    chestAnterior: 'reaction_chest',
    heart: 'reaction_heart',
    abdomen: 'reaction_abdomen',
};

export default function Exam3DScreen({ activeCase, sessionId, onOpenDrawer, conversation: conversationBus = null }) {
    // Order matters to the i18n extractor, which files every `t(` call under
    // the LAST namespace named in the file: the room's and the monitor's
    // translators are not extracted (their keys are maintained by hand), so
    // 'chat' stays last for the one chat key this screen uses.
    const { t: tRoom } = useTranslation('room3d');
    const { t: tMonitor } = useTranslation('monitor');
    const { t } = useTranslation('chat');
    const hostRef = useRef(null);
    const reactionLine = useCallback(
        (regionId) => tRoom(REACTION_KEYS[regionId] ?? 'reaction_default'),
        [tRoom],
    );
    // Rohy's examination manikin, opened from the "Body map" pill.
    const [manikinOpen, setManikinOpen] = useState(false);
    const manikinOpenRef = useRef(manikinOpen);
    useEffect(() => { manikinOpenRef.current = manikinOpen; }, [manikinOpen]);
    // The finding on show from the wheel; the manikin shows its own.
    const [finding, setFinding] = useState(null);
    // What the patient last said, and whether that line is actually being
    // spoken aloud. A silent room (voice mode off, muted, or a case whose
    // voice cannot play) must still SHOW the answer — captioning only what
    // is audible is indistinguishable from a patient who never replies.
    const [caption, setCaption] = useState({ line: null, spoken: false });
    // The chat room owns the patient's voice for conversation turns (it
    // speaks the reply it streams); this room reads the shared speaking
    // state and viseme stream so the body on the bed mouths the same words.
    const { speaking: chatSpeaking, visemes: chatVisemes, voiceMode: chatVoiceMode } = useVoice();
    const [voiceOn, setVoiceOn] = useState(true);
    // The learner's own words, live from the recogniser, for the caption.
    const [heard, setHeard] = useState({ listening: false, interim: '' });
    const micRef = useRef(null);
    // VoiceControl mirrors the mic on an effect keyed by this callback, so it
    // must be stable — and it must not hand back a fresh object for an
    // unchanged transcript, or the two would re-render each other forever.
    const handleHeard = useCallback((listening, interim) => {
        setHeard((prev) => (
            prev.listening === listening && prev.interim === interim
                ? prev
                : { listening, interim }
        ));
    }, []);
    // Live room controller, for camera focus / region emphasis / reactions
    // from React handlers outside the mount effect.
    const roomRef = useRef(null);
    // The patient's mouth moves on the room's own avatar, driven by the same
    // viseme stream Rohy's PatientAvatar uses — the room's morph driver is a
    // port of Rohy's, so one voice moves one mouth the same way in both.
    const showVisemes = useCallback((map) => {
        roomRef.current?.setVisemes?.(map);
    }, []);
    // The Patient persona for this session, resolved through the same shared
    // resolver the chat room uses — it carries the persona's voice, which is
    // the tier that decides whether this patient sounds male or female.
    const patientTemplate = usePatientTemplate({ activeCase, sessionId });
    // Which body is on the bed. Resolved through Rohy's own avatar resolver,
    // so the person in the first screen's portrait and the person lying here
    // are the same patient.
    const avatar = usePatientAvatar({ activeCase });
    // The room's own voice, for scripted lines (exam reactions). It mirrors
    // its visemes into VoiceContext like the chat room does, so one effect
    // below drives the mouth for both.
    const voice = usePatientVoice({
        activeCase,
        enabled: voiceOn,
        patientTemplate,
    });
    useEffect(() => {
        showVisemes(chatVisemes ?? null);
    }, [chatVisemes, showVisemes]);
    // Whether a reply the ROOM asks for will be voiced: the room's switch,
    // and a voice that can play. A turn typed in the chat is voiced on the
    // chat's own terms (its voice mode).
    const roomSpeaks = voiceOn && voice.available;
    // Asking the patient a question out loud. The persona and the thread are
    // the chat room's, reached through the host's conversation grant; only
    // the microphone is the room's own. The answer is written straight into
    // the caption slot below, so a scripted exam reaction and a streamed
    // answer share one line and the later one wins.
    const handleReply = useCallback((line, meta) => {
        const askedHere = meta?.source === 'room3d';
        setCaption({ line, spoken: askedHere ? roomSpeaks : chatVoiceMode, fromConversation: true });
    }, [roomSpeaks, chatVoiceMode]);
    const conversation = useRoomConversation({
        conversation: conversationBus,
        spoken: roomSpeaks,
        onReply: handleReply,
    });
    // Someone is speaking for the patient: the chat room (a conversation
    // reply) or this room (a scripted line).
    const patientSpeaking = Boolean(chatSpeaking) || voice.speaking;
    // Stop whichever voice is talking — the learner may cut the patient off,
    // the way they would in a real room.
    const stopPatient = useCallback(() => {
        voice.stop();
        VoiceService.cancelSpeech();
    }, [voice]);
    // Hold the caption until the audio has a head start — the same gate the
    // chat room uses, since no provider gives word boundaries. It only
    // applies to a line that is actually being spoken; an unspoken line has
    // no audio to wait for and goes straight on screen.
    const subtitleReady = useSubtitleReveal(patientSpeaking, caption.line ?? '');
    // A line only waits for audio that is actually coming. If the voice
    // failed outright — a TTS error, a provider whose model will not load —
    // or the chat room says the reply is not being voiced at all, the
    // words go up regardless, because the alternative is a patient who
    // seems not to have answered at all.
    // The chat's `voiced` verdict is about ITS reply; a scripted exam line
    // spoken by this room is not subject to it.
    const chatVoiced = conversationBus?.voiced ?? null;
    const chatSaysSilent = Boolean(caption.fromConversation) && chatVoiced === false;
    const spokenAloud = caption.spoken && !voice.audioFailed && !chatSaysSilent;
    const patientCaption = spokenAloud
        ? (patientSpeaking && subtitleReady ? caption.line : null)
        : caption.line;
    // The learner speaks the session's language, not the platform's.
    const sttLang = sttLocaleFor(activeCase?.config?.language ?? DEFAULT_LANGUAGE);
    const performExam = usePhysicalExam({
        physicalExam: activeCase?.config?.physical_exam ?? null,
        sessionId,
    });

    // An exam performed on the manikin gets the same diegetic answers from
    // the room as a wheel exam: persistent tint, wince, spoken line. The
    // manikin presents its own finding, so this does not raise FindingPanel.
    const say = (line) => {
        roomRef.current?.say(line);
        setCaption({ line, spoken: voice.speak(line), fromConversation: false });
    };
    const sayRef = useRef(say);

    const handleManikinExam = (entry) => {
        const region3d = SUPINE_REGIONS_3D.find((region) => region.id === entry.regionId);
        // Regions the supine 3D body does not carry (posterior, and the
        // manikin's coarser groupings) simply have nothing to tint.
        if (!region3d) return;
        roomRef.current?.markRegion(entry.regionId, entry.abnormal ? 'abnormal' : 'examined');
        if (!entry.abnormal) return;
        roomRef.current?.react('wince');
        say(reactionLine(entry.regionId));
    };
    // App passes an inline callback and performExam changes identity with
    // the patient record context; route both through refs so a new function
    // identity per render never remounts (and re-loads) the whole room.
    const openDrawerRef = useRef(onOpenDrawer);
    const performExamRef = useRef(performExam);
    useEffect(() => {
        openDrawerRef.current = onOpenDrawer;
        performExamRef.current = performExam;
        sayRef.current = say;
    });

    // Static merge of the supine collider boxes with the exam model.
    const bodyRegions = useMemo(() => supineRegionsWithExams(), []);

    useEffect(() => {
        // Wait for the resolver. Mounting before it answers would put the
        // fallback body on the bed and then swap it, which costs a full
        // remount and shows the learner the wrong patient first.
        if (!avatar.url) return undefined;
        let room = null;
        room = mountPatientRoom(hostRef.current, {
            mode: 'bound',
            waveform: 'host',
            chrome: 'room',
            patient: casePatient(activeCase, tRoom),
            labels: chromeLabels(tRoom),
            avatar_url: avatar.url,
            body_regions: bodyRegions,
            nav_actions: navActions(tRoom),
            // Rohy presents findings itself (FindingPanel → FindingDisplay →
            // AuscultationPanel); the room only needs the abnormal flag to
            // tint the region and drive the wince.
            findings: 'host',
            on_exam: ({ region_id, exam_id, test }) => {
                const entry = performExamRef.current(region_id, exam_id, test);
                // Analytics stays with the screen, as it does for the 2D
                // room — the hook records to the patient record only.
                EventLogger.physicalExamPerformed(region_id, exam_id, entry.finding, {
                    gender: activeCase?.config?.demographics?.gender ?? activeCase?.patient_gender,
                    abnormal: entry.abnormal,
                    room3d: true,
                });
                // setState identity is stable, so this needs no ref.
                setFinding(entry);
                return { finding: entry.finding, abnormal: entry.abnormal };
            },
            on_event: (event) => {
                if (event.type === 'selection') {
                    EventLogger.buttonClicked(`room3d:${event.id}`, 'Room3D', { label: event.label });
                    // A region selection opens the room's own exam wheel.
                    if (event.kind === 'region') return;
                    if (event.id === 'chart') openDrawerRef.current?.('records');
                    if (event.id === 'iv' || event.id === 'oxygen') openDrawerRef.current?.('treatments');
                }
                if (event.type === 'nav') {
                    if (event.id === 'records') openDrawerRef.current?.('records');
                    if (event.id === 'bodymap') setManikinOpen(true);
                }
                if (event.type === 'exam' && event.abnormal) {
                    sayRef.current(reactionLine(event.region_id));
                }
                if (event.type === 'status') {
                    room?.addTimelineEvent(`Patient status: ${event.status}.`);
                }
            },
        });

        roomRef.current = room;

        // The room's ECG canvas carries the monitor's real signal — the same
        // generator PatientMonitor draws with, driven by the live hr + rhythm.
        const stopEcg = startEcgMirror(room.ecg_canvas, () => EventLogger.currentVitals);

        const pushVitals = (elapsed_seconds) => {
            const vitals = mapVitals(EventLogger.currentVitals);
            if (!vitals) return;
            // null clears the label override, so a conversion back to sinus
            // returns the monitor to its heart-rate-derived rhythm text.
            const rhythm = rhythmLabel(EventLogger.currentVitals?.rhythm, tMonitor);
            room.update(vitals, null, elapsed_seconds, { rhythm });
        };
        let elapsed_seconds = 0;
        pushVitals(0);
        const vitals_timer = setInterval(() => {
            elapsed_seconds += 1;
            pushVitals(elapsed_seconds);
        }, 1000);

        return () => {
            clearInterval(vitals_timer);
            stopEcg();
            room.dispose();
            roomRef.current = null;
        };
    }, [activeCase, sessionId, bodyRegions, avatar.url, reactionLine, tMonitor, tRoom]);

    // The finding chart docks left, so hand that side over while it is up.
    useEffect(() => {
        roomRef.current?.setNavSide?.(finding ? 'right' : 'left');
    }, [finding]);

    // Space is push-to-talk in the room — and this listener is deliberately
    // on the CAPTURE phase so it also SHIELDS the key.
    //
    // ChatInterface is still mounted underneath (hidden and inert, so the
    // vitals keep running), and it carries its own window-level Space
    // handler for its voice mode. A window capture listener runs before any
    // window bubble listener, so stopping propagation here means one press
    // opens one microphone — the room's — instead of two racing recognisers
    // on a screen the learner cannot see.
    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.code !== 'Space' && event.key !== ' ') return;
            if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
            const el = event.target;
            const tag = el?.tagName;
            // Never hijack Space from a control or a field that wants it,
            // nor while a surface above the room (the manikin) has the floor.
            if (manikinOpenRef.current) return;
            if (el?.isContentEditable
                || tag === 'INPUT' || tag === 'TEXTAREA'
                || tag === 'SELECT' || tag === 'BUTTON'
                || tag === 'A' || el?.getAttribute?.('role') === 'button') return;
            event.preventDefault();
            event.stopPropagation();
            micRef.current?.toggle();
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, []);

    return (
        <div className="fixed inset-0 z-30 bg-black">
            {/* The mount host ends 72px above the viewport bottom so the room
                (whose canvas sizing reads clientHeight) never renders under
                the fixed RoomNavigator band. */}
            <div className="absolute inset-x-0 top-0 bottom-[72px]">
                {/* The package positions its own root; the slot around it
                    owns the geometry, so the two never contest one box. */}
                <div ref={hostRef} className="h-full w-full" />
            </div>
            {/* Sits one tier above the OrdersDrawer pill strip, which docks
                at the very left (fabAlign 'left') while this room is active. */}
            {!manikinOpen && (
                <button
                    type="button"
                    onClick={() => setManikinOpen(true)}
                    className="absolute bottom-[136px] left-4 z-10 flex items-center gap-2 rounded-full border border-teal-500/25 bg-neutral-950/85 px-3 py-1.5 text-xs font-semibold text-teal-200 backdrop-blur transition-colors hover:border-teal-400/50 hover:text-white"
                >
                    <Map className="h-3.5 w-3.5" aria-hidden="true" />
                    {tRoom('body_map')}
                </button>
            )}
            {manikinOpen && (
                <ManikinOverlay
                    activeCase={activeCase}
                    onExamPerformed={handleManikinExam}
                    onClose={() => setManikinOpen(false)}
                />
            )}
            <FindingPanel entry={finding} onClose={() => setFinding(null)} />

            {/* Voice control: one button, because there is one thing to
                decide — whether the patient is audible. Clicking it while
                the patient is mid-sentence stops that sentence. */}
            {voice.available && (
                <button
                    type="button"
                    onClick={() => {
                        if (patientSpeaking) stopPatient();
                        setVoiceOn((current) => !current);
                    }}
                    aria-pressed={voiceOn}
                    aria-label={voiceOn ? tRoom('voice_mute') : tRoom('voice_unmute')}
                    className={`absolute bottom-[136px] left-[132px] z-10 flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold backdrop-blur transition-colors ${
                        voiceOn
                            ? 'border-teal-500/30 bg-neutral-950/85 text-teal-200 hover:border-teal-400/60 hover:text-white'
                            : 'border-neutral-700 bg-neutral-950/85 text-neutral-500 hover:text-neutral-300'
                    }`}
                >
                    {voiceOn
                        ? <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                        : <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />}
                    {patientSpeaking ? tRoom('voice_speaking') : tRoom('voice_label')}
                    {patientSpeaking && (
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-300" aria-hidden="true" />
                    )}
                </button>
            )}

            {/* The microphone. Rohy's own VoiceControl — the same control the
                debrief screen uses, in the room's palette — so there is one
                microphone in the product and it speaks seven languages. */}
            {sessionId && (
                <div className="absolute bottom-[92px] left-1/2 z-10 -translate-x-1/2">
                    {conversation.error && (
                        <p className="mb-2 max-w-xs text-center text-xs text-rose-300/90">
                            {conversation.error}
                        </p>
                    )}
                    <VoiceControl
                        ref={micRef}
                        variant="room"
                        // The debrief's fallback line points at a type
                        // button; this room has none, so it passes the
                        // platform's own generic sentence instead.
                        unsupportedText={t('stt_not_supported_browser')}
                        sttLang={sttLang}
                        busy={conversation.thinking}
                        speaking={patientSpeaking}
                        // Barge-in: the learner may cut the patient off, the
                        // way they would in a real room.
                        onInterrupt={stopPatient}
                        onListeningChange={handleHeard}
                        onSend={conversation.ask}
                    />
                </div>
            )}

            {/* Subtitles are the screen: the line sits over the room, big
                enough to read at a distance, and leaves when the patient
                stops. Anchored above the finding chart and the pill row.
                While the learner is talking it shows THEIR words instead —
                one caption, whoever is speaking. */}
            <SubtitleBand
                line={heard.listening ? (heard.interim || null) : patientCaption}
                listening={heard.listening}
                speaker={heard.listening ? tRoom('speaker_you').toUpperCase() : (casePatient(activeCase, tRoom)?.speaker ?? tRoom('speaker_patient').toUpperCase())}
                anchor="calc(100vh - 360px)"
                // Three rows at most: the microphone sits below the strip,
                // and a long opening line used to run down over it.
                maxLines={3}
            />
        </div>
    );
}
