import { useEffect, useMemo, useState } from 'react';
import { useVoice } from '../../contexts/VoiceContext';
import { resolveAvatarId } from '../../utils/resolveAvatar';
import { resolveCamera } from '../../utils/avatarFraming';
import { baseUrl } from '../../config/api';
import { apiFetch } from '../../services/apiClient.js';

/**
 * Which body lies on the bed — resolved exactly as the first screen resolves
 * the face in its portrait.
 *
 * The room used to answer this with one line: the case's `avatar_id`, else
 * the literal string 'avatarsdk.glb'. No case in a seeded database sets an
 * avatar_id, so every patient on the bed was the same male adult while the
 * portrait picked a gender- and age-matched avatar from the manifest. A
 * 72-year-old woman was a man in the room.
 *
 * `resolveAvatarId` is Rohy's own four-tier resolver (explicit id → platform
 * default for the demographic slot → a deterministic pick seeded on the
 * patient's own id → manifest fallback), so the same case resolves the same
 * person on both screens, and keeps resolving that person across sessions.
 *
 * The manifest and platform defaults come from VoiceContext, which
 * ChatInterface fills; they are fetched here as a fallback for the same
 * reason usePatientVoice fetches voice settings — a room that opens before
 * the chat has fetched them must not resolve against nothing.
 *
 * @param {{activeCase: object|null}} options
 * @return {{url: string|null, avatarId: string|null, camera: object|null}}
 *   `url` is null until the manifest is known; the room waits rather than
 *   mounting the wrong body and swapping it a moment later.
 */
export default function usePatientAvatar({ activeCase }) {
    const { headManifest, setHeadManifest, platformAvatars, setPlatformAvatars } = useVoice();
    const [fetchedManifest, setFetchedManifest] = useState(null);
    const [fetchedDefaults, setFetchedDefaults] = useState(null);
    const manifest = headManifest ?? fetchedManifest;
    const defaults = platformAvatars ?? fetchedDefaults;

    useEffect(() => {
        if (headManifest) return undefined;
        let cancelled = false;
        fetch(baseUrl('/avatars/heads/manifest.json'))
            .then((response) => response.json())
            .then((payload) => {
                if (cancelled || !payload) return;
                setFetchedManifest(payload);
                setHeadManifest(payload);
            })
            .catch(() => {
                // Left null: the room falls back to the case's own avatar_id
                // below rather than blocking on a manifest it cannot read.
            });
        return () => { cancelled = true; };
    }, [headManifest, setHeadManifest]);

    useEffect(() => {
        if (platformAvatars) return undefined;
        let cancelled = false;
        apiFetch('/platform-settings/avatars')
            .then((payload) => {
                if (cancelled || !payload) return;
                setFetchedDefaults(payload);
                setPlatformAvatars(payload);
            })
            .catch(() => {
                // One tier thinner; the demographic pick still applies.
            });
        return () => { cancelled = true; };
    }, [platformAvatars, setPlatformAvatars]);

    // The same patient descriptor the first screen builds, so the
    // deterministic pick lands on the same avatar rather than a different
    // one drawn from the same pool.
    const patient = useMemo(() => {
        const config = activeCase?.config ?? {};
        return {
            avatar_id: config.avatar_id || null,
            avatar_camera: config.avatar_camera || null,
            gender: activeCase?.patient_gender || config.demographics?.gender,
            name: activeCase?.patient_name || config.patient_name,
            age: activeCase?.patient_age || config.demographics?.age,
            id: activeCase?.id,
        };
    }, [activeCase]);

    return useMemo(() => {
        if (!manifest) {
            // No manifest yet. An explicitly authored avatar needs no
            // resolver, so honour it immediately; otherwise wait rather than
            // showing the wrong person.
            return patient.avatar_id
                ? {
                    url: baseUrl(`/avatars/heads/${patient.avatar_id}`),
                    avatarId: patient.avatar_id,
                    camera: patient.avatar_camera,
                }
                : { url: null, avatarId: null, camera: null };
        }
        const avatarId = resolveAvatarId({
            avatarId: patient.avatar_id,
            gender: patient.gender,
            manifest,
            platformAvatars: defaults,
            patient,
        });
        if (!avatarId) return { url: null, avatarId: null, camera: null };
        return {
            url: baseUrl(`/avatars/heads/${avatarId}`),
            avatarId,
            camera: resolveCamera(manifest, avatarId, patient.avatar_camera),
        };
    }, [manifest, defaults, patient]);
}
