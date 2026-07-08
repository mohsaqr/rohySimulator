// Locale-aware formatters (I18N_PLAN.md §8): dates, times, and numbers
// rendered via Intl keyed off the ACTIVE UI LANGUAGE — Finnish/Swedish use
// 7.7.2026 and decimal commas; ad-hoc `toLocaleString()` (browser locale,
// not app language) and `toFixed()+concat` are banned in student-facing
// code in favour of these.
//
// Safe during render: components already re-render on language change via
// useTranslation, and these read i18n.language at call time.

import i18n from '../i18n/index.js';
import { DEFAULT_LANGUAGE } from '../i18n/languages.js';

const locale = () => i18n.language || DEFAULT_LANGUAGE;

/** e.g. en: "Jul 8, 2026" · fi: "8.7.2026" */
export function formatDate(value, options = { dateStyle: 'medium' }) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(locale(), options).format(d);
}

/** e.g. en: "2:35 PM" · fi: "14.35" */
export function formatTime(value, options = { timeStyle: 'short' }) {
    return formatDate(value, options);
}

/** e.g. en: "Jul 8, 2026, 2:35 PM" */
export function formatDateTime(value, options = { dateStyle: 'medium', timeStyle: 'short' }) {
    return formatDate(value, options);
}

/** e.g. en: "37.8" · fi/sv: "37,8". Pass Intl.NumberFormat options for
 *  fixed decimals: formatNumber(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) */
export function formatNumber(value, options = {}) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return new Intl.NumberFormat(locale(), options).format(n);
}
