// Join-code generation for cohorts — the SINGLE owner of the alphabet /
// length / collision-retry logic. Both the cohort routes (POST /cohorts,
// POST /cohorts/:id/join-code) and the boot seed (per-case dedicated
// courses in server/seedStemiCourse.js) allocate codes through here so the
// rules can never drift apart.
import crypto from 'crypto';
import dbAdapter from '../dbAdapter.js';
import { logger } from '../logger.js';

const log = logger('join-code');

// Excludes ambiguous glyphs (0/O, 1/I/L) so a shared code can't be
// mistyped between teacher and student.
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 8;
const JOIN_CODE_MAX_RETRIES = 6;

/**
 * A random code from the ambiguity-free alphabet.
 *
 * Registration invites reuse this (at a longer length) rather than minting a
 * second alphabet: the same string has to survive being READ ALOUD, TYPED from
 * a slide, and PASTED from a URL, which is exactly the constraint this alphabet
 * already solves. One owner, one set of rules.
 */
export function generateCode(length = JOIN_CODE_LENGTH) {
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += JOIN_CODE_ALPHABET[bytes[i] % JOIN_CODE_ALPHABET.length];
    }
    return out;
}

export function generateJoinCode() {
    return generateCode(JOIN_CODE_LENGTH);
}

/**
 * Fold user input back to a canonical code: uppercase, and drop anything that
 * is not in the alphabet. This is what makes ONE token work as both a typed
 * code and a link — "abcd-efgh-jklm" pasted with hyphens, "ABCD EFGH JKLM" read
 * off a slide, and ?invite=ABCDEFGHJKLM from a URL all normalise to the same
 * string, so there is no second artifact to keep in sync.
 */
export function normalizeCode(input) {
    return String(input || '')
        .toUpperCase()
        .split('')
        .filter((ch) => JOIN_CODE_ALPHABET.includes(ch))
        .join('');
}

// Allocate a join_code on `cohort`, retrying on a partial-unique collision
// against another live cohort's code. Returns the code on success, or null
// if every retry collided (the caller decides how to surface that).
export async function allocateJoinCode(cohortId) {
    let lastErr = null;
    for (let attempt = 0; attempt < JOIN_CODE_MAX_RETRIES; attempt++) {
        const code = generateJoinCode();
        try {
            await dbAdapter.run(`UPDATE cohorts SET join_code = ? WHERE id = ?`, [code, cohortId]);
            return code;
        } catch (err) {
            // Partial-unique collision on a live join_code — retry with a
            // fresh code. Any other error is fatal.
            if (/UNIQUE constraint/i.test(err.message)) {
                lastErr = err;
                continue;
            }
            throw err;
        }
    }
    log.error('join code generation exhausted retries', {
        cohort_id: cohortId,
        error: lastErr?.message,
    });
    return null;
}
