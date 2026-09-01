import { useEffect, useState } from 'react';
import { AgentService } from '../../services/AgentService';
import { resolvePatientTemplate } from '../../utils/patientTemplate';

/**
 * The Patient persona template for this session, resolved exactly as the
 * chat room resolves it — same shared `resolvePatientTemplate`, same session
 * agents, same gender-matched platform default.
 *
 * The room needs it for one reason: the persona tier of the voice resolver.
 * Without it every case with no explicit voice fell through to the
 * platform's per-language default, which is female — so a male patient
 * answered in a woman's voice while the chat room, which does pass this
 * tier, sounded correct.
 *
 * @param {{activeCase: object|null, sessionId: string|number|null}} options
 * @return {object|null} Normalised template, or null while loading / when
 *   the case has no resolvable patient persona.
 */
export default function usePatientTemplate({ activeCase, sessionId }) {
    const [template, setTemplate] = useState(null);

    useEffect(() => {
        if (!sessionId || !activeCase) return undefined;
        let cancelled = false;
        AgentService.getSessionAgents(sessionId)
            .then((agents) => resolvePatientTemplate(
                agents,
                activeCase,
                () => AgentService.getTemplates(),
            ))
            .then((resolved) => {
                if (!cancelled) setTemplate(resolved);
            })
            .catch(() => {
                // No persona tier; the voice resolver falls through to the
                // platform default exactly as it did before.
                if (!cancelled) setTemplate(null);
            });
        return () => { cancelled = true; };
    }, [activeCase, sessionId]);

    // Never let a case switch hand this case's room the previous persona —
    // the same stamp guard the chat room applies. Both sides are normalised
    // to null first: the stamp is `id ?? null`, so a case carrying no id at
    // all would otherwise compare null against undefined and discard a
    // perfectly good template.
    const stampedFor = template?._caseId ?? null;
    return template && stampedFor === (activeCase?.id ?? null) ? template : null;
}
