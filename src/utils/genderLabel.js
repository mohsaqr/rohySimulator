import { genderDisplayKey } from '../../server/shared/patientDemographics.js';

/**
 * A stored patient gender ('Male', 'female', …), in the reader's language.
 *
 * The keys are spelled out (not `t(\`common:${key}\`)`) so the i18n extractor
 * sees them — a dynamic key is invisible to `i18n:check`.
 *
 * @param {(key: string) => string} t  any namespace's t(); keys are qualified
 * @param {unknown} value  the stored gender
 * @returns {string} the label, or '' for a missing / unrecognised value
 */
export function genderLabel(t, value) {
    switch (genderDisplayKey(value)) {
        case 'gender_male': return t('common:gender_male');
        case 'gender_female': return t('common:gender_female');
        case 'gender_other': return t('common:gender_other');
        default: return '';
    }
}
