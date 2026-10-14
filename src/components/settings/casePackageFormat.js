// Number formatting for the case package dialogs (CasePackages.jsx).

/**
 * Bytes in binary units with IEC symbols (KiB, MiB, GiB — the server counts
 * in powers of 1024 too), the number in the UI language: "2,8 GiB" in
 * Finnish, "2.8 GiB" in English (FI-0010 F16).
 *
 * @param {number} bytes
 * @param {string} locale  the UI language, e.g. i18n.resolvedLanguage
 * @returns {string} '' when `bytes` is not a finite number
 */
export function formatBytes(bytes, locale) {
    if (!Number.isFinite(bytes)) return '';
    const units = [['GiB', 1024 ** 3], ['MiB', 1024 ** 2], ['KiB', 1024]];
    const [unit, size] = units.find(([, s]) => bytes >= s) ?? units[units.length - 1];
    const value = unit === 'KiB' ? Math.max(1, Math.round(bytes / size)) : bytes / size;
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

/**
 * Elapsed time as m:ss or h:mm:ss — read the same in every language.
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatElapsed(ms) {
    const total = Math.max(0, Math.floor((ms || 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}
