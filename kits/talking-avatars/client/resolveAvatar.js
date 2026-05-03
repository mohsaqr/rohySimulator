// Single source of truth for "what GLB should this participant render?"
//
// Resolution order:
//   1. explicit avatarId (case.config.avatar_id, agent.avatar_url)
//   2. platform default by gender
//   3. demographic auto-pick (hash-based)
//   4. manifest.fallback[0]

// Loose female detector — covers "Female", "female", "F", "f". Used wherever
// an avatar/voice has to fork by gender so all sites agree on the rule.
export const isFemale = (gender) => /^f/i.test(gender || '');

export function resolveAvatarId({ avatarId, gender, manifest, platformAvatars, demographicPicker, patient }) {
    if (avatarId && manifest?.all?.some(a => a.id === avatarId)) {
        return avatarId;
    }
    const platformDefault = isFemale(gender)
        ? platformAvatars?.default_avatar_female
        : platformAvatars?.default_avatar_male;
    if (platformDefault && manifest?.all?.some(a => a.id === platformDefault)) {
        return platformDefault;
    }
    if (typeof demographicPicker === 'function') {
        const picked = demographicPicker(patient || { gender }, manifest);
        if (picked) return picked;
    }
    const fb = manifest?.fallback?.[0];
    if (fb && manifest?.all?.some(a => a.id === fb)) return fb;
    return null;
}
