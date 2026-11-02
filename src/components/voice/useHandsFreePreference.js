import { useCallback, useContext } from 'react';
import { NotificationContextObject } from '../../notifications/NotificationContextObject';

/**
 * The learner's hands-free preference (`prefs.handsFreeConversation`, saved
 * per user and whitelisted by the server). ONE switch for every voice
 * surface: turning it on in the phone call turns it on in the patient chat,
 * the debrief and the Bedside room too.
 *
 * Read without throwing: a surface rendered outside the NotificationProvider
 * (a unit test, an embed) gets push-to-talk and no switch.
 *
 * @returns {{handsFree: boolean, setHandsFree: (on: boolean) => void, available: boolean,
 *   mode: 'handsFree'|'pushToTalk'}}
 */
export function useHandsFreePreference() {
    const ctx = useContext(NotificationContextObject);
    const handsFree = ctx?.prefs?.handsFreeConversation === true;
    const setPrefs = ctx?.setPrefs;
    const setHandsFree = useCallback((on) => setPrefs?.({ handsFreeConversation: on === true }), [setPrefs]);
    return {
        handsFree,
        setHandsFree,
        available: Boolean(setPrefs),
        mode: handsFree ? 'handsFree' : 'pushToTalk',
    };
}
