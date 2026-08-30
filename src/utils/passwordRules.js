// The client-side mirror of the server's password policy — validatePassword()
// in server/routes/_helpers.js is the enforcing copy. If you change one,
// change the other, or users type a password the form accepts and the server
// rejects (which is exactly the bug this file was created to kill: the
// register form said "min 6 characters" while the server demanded 8+ with
// mixed case and a digit).
//
// The server's rules, in order, as of server/routes/_helpers.js:341-357:
//   length >= 8, length <= 128, one lowercase, one uppercase, one digit.

/** The server's upper bound — `password.length > 128` is a 400 there. */
export const PASSWORD_MAX_LENGTH = 128;

/** Each rule keys an i18n string `password_req_<key>` in the auth namespace. */
export const PASSWORD_RULES = [
    { key: 'length', test: (p) => (p || '').length >= 8 },
    // The mirror's other half. Without it the form happily accepted a
    // 129-character passphrase and the server answered 400 — the precise
    // failure this file exists to prevent.
    { key: 'max', test: (p) => (p || '').length <= PASSWORD_MAX_LENGTH },
    { key: 'upper', test: (p) => /[A-Z]/.test(p || '') },
    { key: 'lower', test: (p) => /[a-z]/.test(p || '') },
    { key: 'digit', test: (p) => /[0-9]/.test(p || '') },
];

/** True when the password would pass the server's validatePassword(). */
export function passwordMeetsRules(password) {
    return PASSWORD_RULES.every((rule) => rule.test(password));
}
