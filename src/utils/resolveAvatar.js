// Single source of truth for "what GLB should this participant render?"
//
// Resolution order:
//   1. explicit avatarId (case.config.avatar_id, agent.avatar_url)
//   2. platform default by slot (child, female, male)
//   3. demographic auto-pick (hash-based)
//   4. manifest.fallback[0]

// Loose female detector — covers "Female", "female", "F", "f". Used wherever
// an avatar/voice has to fork by gender so all sites agree on the rule.
export const isFemale = (gender) => /^f/i.test(gender || '');

export function deriveAvatarSlot(gender, age) {
    const safeAge = Number.isFinite(Number(age)) ? Number(age) : 35;
    if (safeAge < 13) return 'child';
    return isFemale(gender) ? 'female' : 'male';
}

export function avatarAgeBucket(age) {
    const safeAge = Number.isFinite(Number(age)) ? Number(age) : 35;
    if (safeAge < 13) return 'child';
    if (safeAge < 40) return 'young';
    if (safeAge < 65) return 'middle';
    return 'elderly';
}

export function isKnownAvatarId(manifest, id) {
    return !!id && !!manifest?.all?.some(a => a.id === id);
}

export function avatarMatchesSlot(entry, slot) {
    if (!entry || !slot) return true;
    if (slot === 'child') return entry.age === 'child' || /child/i.test(`${entry.id || ''} ${entry.label || ''}`);
    if (entry.age === 'child') return false;
    return !entry.gender || entry.gender === slot;
}

export function avatarsForSlot(manifest, slot, selectedId = '') {
    const all = manifest?.all || [];
    const matching = all.filter(a => avatarMatchesSlot(a, slot));
    if (!selectedId || matching.some(a => a.id === selectedId)) return matching;
    const selected = all.find(a => a.id === selectedId);
    return selected ? [selected, ...matching] : matching;
}

function deterministicIndex(seed, length) {
    if (!length) return 0;
    let h = 0;
    const s = String(seed ?? '');
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h) % length;
}

export function pickDemographicAvatar(patient, manifest) {
    if (!manifest) return null;
    const slot = deriveAvatarSlot(patient?.gender, patient?.age);
    const bucket = avatarAgeBucket(patient?.age);

    let pool = [];
    if (slot === 'child') {
        const childIds = manifest.child || [];
        const childEntries = childIds
            .map(id => manifest.all?.find(a => a.id === id))
            .filter(Boolean);
        const preferredGender = isFemale(patient?.gender) ? 'female' : 'male';
        const genderMatched = childEntries.filter(a => !a.gender || a.gender === preferredGender);
        pool = (genderMatched.length ? genderMatched : childEntries).map(a => a.id);
    } else {
        pool = manifest[slot]?.[bucket] || [];
    }

    if (pool.length === 0) pool = manifest.fallback || [];
    const knownPool = pool.filter(id => isKnownAvatarId(manifest, id));
    if (knownPool.length === 0) return null;

    const seed = patient?.id ?? patient?.name ?? `${slot}:${bucket}`;
    return knownPool[deterministicIndex(seed, knownPool.length)];
}

export function resolveAvatarId({ avatarId, gender, manifest, platformAvatars, demographicPicker, patient }) {
    if (isKnownAvatarId(manifest, avatarId)) {
        return avatarId;
    }
    const slot = deriveAvatarSlot(gender ?? patient?.gender, patient?.age);
    const platformDefault = platformAvatars?.[`default_avatar_${slot}`];
    const defaultEntry = manifest?.all?.find(a => a.id === platformDefault);
    if (defaultEntry && avatarMatchesSlot(defaultEntry, slot)) {
        return platformDefault;
    }
    if (typeof demographicPicker === 'function') {
        const picked = demographicPicker(patient || { gender }, manifest);
        if (isKnownAvatarId(manifest, picked)) return picked;
    } else {
        const picked = pickDemographicAvatar(patient || { gender }, manifest);
        if (picked) return picked;
    }
    const fb = manifest?.fallback?.[0];
    if (isKnownAvatarId(manifest, fb)) return fb;
    return null;
}
