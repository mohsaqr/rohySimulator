import { useTranslation } from 'react-i18next';
import { DoorOpen, Lock, Info } from 'lucide-react';
import { ROOM_DEFS } from '../common/RoomNavigator';
import { FIXED_ROOMS, disabledRooms, specialistAnswers } from '../../../server/shared/caseRooms.js';
import { SPECIALIST_TYPES } from '../../../server/shared/specialties.js';
import { SPECIALTY_LABEL_KEYS } from '../oncall/onCallModel';

const SWITCH_ON = 'var(--rohy-accent, #0d9488)';
const SWITCH_OFF = 'var(--rohy-border-strong, #737373)';

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Whether the case carries material a switched-off room would have shown. Only
// a hint for the author ("kept, hidden from learners"), never a rule: a
// plugin room's own gate is richer than "a document is stored".
function hasMaterial(config, key) {
    if (key === 'lab') return Array.isArray(config.investigations?.labs) && config.investigations.labs.length > 0;
    if (key === 'radiology') return Array.isArray(config.radiology) && config.radiology.length > 0;
    if (key === 'examination') return isPlainObject(config.physical_exam) && Object.keys(config.physical_exam).length > 0;
    return isPlainObject(config[key]) && Object.keys(config[key]).length > 0;
}

/**
 * The wizard step that switches rooms off for a case (config.rooms,
 * server/shared/caseRooms.js).
 *
 * A switched-off room has no tab and cannot be entered, and the server refuses
 * its actions for a learner. Its material is KEPT — switching a room back on
 * brings it back as it was. The patient room is always on.
 *
 * Room names and icons are the room bar's own (ROOM_DEFS), so the switch an
 * author sees is the tab a learner would have seen.
 */
export function CaseRoomsStep({ caseData, setCaseData }) {
    // One hook, three namespaces: the room bar's labels live in `common` and
    // the specialty names in `oncall`; this step's own keys are the default.
    const { t } = useTranslation(['authoring_config', 'common', 'oncall']);
    const config = caseData?.config ?? {};
    const off = disabledRooms(config);

    const toggle = (key) => {
        setCaseData((prev) => {
            const current = disabledRooms(prev.config);
            const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key].sort();
            // No setting at all means every room is on, so an empty list is
            // removed rather than stored.
            const { rooms: _previous, ...rest } = prev.config ?? {};
            return { ...prev, config: next.length > 0 ? { ...rest, rooms: { disabled: next } } : rest };
        });
    };

    const silent = SPECIALIST_TYPES.filter((type) => !specialistAnswers(type, config));

    return (
        <div className="space-y-4" data-testid="case-rooms-step">
            <div className="flex items-start gap-3">
                <DoorOpen className="w-5 h-5 text-teal-400 mt-0.5 shrink-0" />
                <p className="text-sm text-neutral-400">{t('rooms_step_help')}</p>
            </div>

            <ul className="space-y-2">
                {ROOM_DEFS.map((room) => {
                    const fixed = FIXED_ROOMS.includes(room.key);
                    const on = fixed || !off.includes(room.key);
                    const Icon = room.icon;
                    const label = t(room.labelKey, { ns: 'common' });
                    let note = null;
                    if (fixed) note = t('rooms_fixed_note');
                    else if (!on && hasMaterial(config, room.key)) note = t('rooms_material_kept');
                    else if (on && room.isPlugin && room.key !== 'room3d' && !hasMaterial(config, room.key)) {
                        note = t('rooms_needs_material');
                    }
                    return (
                        <li
                            key={room.key}
                            className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${on
                                ? 'bg-neutral-800/60 border-neutral-700'
                                : 'bg-neutral-900/60 border-neutral-800 opacity-70'}`}
                        >
                            {Icon && <Icon className="w-5 h-5 text-neutral-300 shrink-0" aria-hidden="true" />}
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-neutral-100">{label}</div>
                                {note && <div className="text-xs text-neutral-400">{note}</div>}
                            </div>
                            {fixed ? (
                                <span className="flex items-center gap-1 text-xs text-neutral-400">
                                    <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                                    {t('rooms_always_on')}
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={on}
                                    aria-label={t('rooms_toggle_label', { room: label })}
                                    data-testid={`room-toggle-${room.key}`}
                                    onClick={() => toggle(room.key)}
                                    className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
                                    // Colours inline, not as utility classes: the admin light
                                    // theme (index.css, .rohy-admin-light) repaints every
                                    // bg-neutral-* / bg-white to the card surface, which drew
                                    // the OFF switch white on a white card — invisible.
                                    style={{ background: on ? SWITCH_ON : SWITCH_OFF }}
                                >
                                    <span
                                        className={`inline-block h-4 w-4 rounded-full transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`}
                                        style={{ background: '#ffffff', boxShadow: '0 1px 2px rgb(15 23 42 / 0.3)' }}
                                    />
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>

            {(off.includes('consultant') || silent.length > 0) && (
                <div className="space-y-2 rounded-lg border border-neutral-700 bg-neutral-800/40 p-3 text-xs text-neutral-300">
                    {off.includes('consultant') && (
                        <p className="flex items-start gap-2">
                            <Info className="w-4 h-4 shrink-0 text-teal-400" aria-hidden="true" />
                            {t('rooms_no_debrief_note')}
                        </p>
                    )}
                    {silent.length > 0 && (
                        <p className="flex items-start gap-2" data-testid="rooms-silent-specialists">
                            <Info className="w-4 h-4 shrink-0 text-teal-400" aria-hidden="true" />
                            {t('rooms_no_answer_note', {
                                specialists: silent.map((type) => t(SPECIALTY_LABEL_KEYS[type], { ns: 'oncall' })).join(', '),
                            })}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

export default CaseRoomsStep;
