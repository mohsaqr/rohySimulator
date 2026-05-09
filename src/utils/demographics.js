// Shared demographic bucket helpers for voice and avatar routing.

export const isFemale = (gender) => /^f/i.test(gender || '');

export function deriveDemographicSlot(gender, age) {
    const safeAge = Number.isFinite(Number(age)) ? Number(age) : 35;
    if (safeAge < 13) return 'child';
    return isFemale(gender) ? 'female' : 'male';
}
