// The client-side mirror of the server's password policy — validatePassword()
// in server/routes/_helpers.js is the enforcing copy. If you change one,
// change the other, or users type a password the form accepts and the server
// rejects (which is exactly the bug this file was created to kill: the
// register form said "min 6 characters" while the server demanded 8+ with
// mixed case and a digit).

/** Each rule keys an i18n string `password_req_<key>` in the auth namespace. */
export const PASSWORD_RULES = [
    { key: 'length', test: (p) => (p || '').length >= 8 },
    { key: 'upper', test: (p) => /[A-Z]/.test(p || '') },
    { key: 'lower', test: (p) => /[a-z]/.test(p || '') },
    { key: 'digit', test: (p) => /[0-9]/.test(p || '') },
];

/** True when the password would pass the server's validatePassword(). */
export function passwordMeetsRules(password) {
    return PASSWORD_RULES.every((rule) => rule.test(password));
}
