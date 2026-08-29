/**
 * The one way a plugin's server module may run an external binary (RPS-1 1.4).
 *
 * A plugin does not import `child_process`. It calls this, and this refuses
 * anything not on the host's allowlist.
 *
 * WHY AN ALLOWLIST AND NOT A REVIEW
 *
 * §1 of the standard is explicit that plugins are not a security boundary —
 * they are ordinary bundled code and a hostile one is out of scope. That is
 * true of the CLIENT bundle. A server module is different in one specific way:
 * it runs as the rohy service user with the deployment's filesystem and network
 * position, and the failure being prevented here is not a hostile plugin but a
 * COOPERATIVE one building a command string out of a filename someone typed
 * into a URL. An allowlist plus argv (never a shell) makes that class of bug
 * unrepresentable rather than merely unlikely.
 *
 * NO SHELL, EVER. `spawn` with an argv array means a filename containing
 * `; rm -rf /` is a filename — the classic reason image pipelines get owned is
 * a shell interpolation two layers below where the name was accepted.
 */
import { spawn } from 'node:child_process';
import { logger } from '../logger.js';

const log = logger('plugin-spawn');

/**
 * Binaries a plugin's server module may run.
 *
 * `vips` and `vipsheader` are libvips' CLI (apt: libvips-tools). They are here
 * because whole-slide tiling has no in-process JS equivalent — not because
 * running binaries is a general facility to grow.
 */
export const ALLOWED_BINARIES = ['vips', 'vipsheader'];

/** A refusal a caller can branch on. */
export class PluginSpawnError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'PluginSpawnError';
        this.code = code;
    }
}

/**
 * Run an allow-listed binary with an argv array.
 *
 * @param {string}   bin        must be in ALLOWED_BINARIES
 * @param {string[]} args
 * @param {object}   [opts]
 * @param {number}   [opts.timeoutMs]  killed past this, reported as a failure
 * @param {number}   [opts.maxOutputBytes] cap on captured stdout/stderr
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{stdout: string, stderr: string}>}
 * @throws  {PluginSpawnError} on a disallowed binary, a non-zero exit, or a timeout
 */
export function runBinary(bin, args, { timeoutMs = 120_000, maxOutputBytes = 1 << 20, signal } = {}) {
    if (!ALLOWED_BINARIES.includes(bin)) {
        throw new PluginSpawnError(`'${bin}' is not an allowed binary`, 'plugin_spawn_forbidden');
    }
    if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
        throw new PluginSpawnError('arguments must be an array of strings', 'plugin_spawn_bad_args');
    }
    return new Promise((resolve, reject) => {
        // shell:false is the default and is restated here because it is the
        // single most important property of this call.
        const child = spawn(bin, args, { shell: false, signal, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = ''; let stderr = ''; let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);

        // Bounded capture: a tool that prints a warning per tile would otherwise
        // hold a slide's worth of text in the worker's heap.
        child.stdout.on('data', (c) => { if (stdout.length < maxOutputBytes) stdout += c.toString(); });
        child.stderr.on('data', (c) => { if (stderr.length < maxOutputBytes) stderr += c.toString(); });

        child.on('error', (err) => {
            clearTimeout(timer);
            // ENOENT here means the binary is not installed, which is an
            // OPERATOR problem and must not read as a broken slide.
            reject(new PluginSpawnError(
                err.code === 'ENOENT' ? `'${bin}' is not installed on this server` : `${bin} failed to start: ${err.message}`,
                err.code === 'ENOENT' ? 'plugin_spawn_missing' : 'plugin_spawn_failed'
            ));
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (timedOut) {
                return reject(new PluginSpawnError(`${bin} exceeded ${timeoutMs}ms and was killed`, 'plugin_spawn_timeout'));
            }
            if (code !== 0) {
                log.warn('plugin binary exited non-zero', { bin, code, stderr: stderr.slice(0, 500) });
                return reject(new PluginSpawnError(`${bin} exited ${code}: ${stderr.trim().slice(0, 500)}`, 'plugin_spawn_nonzero'));
            }
            return resolve({ stdout, stderr });
        });
    });
}

/**
 * Is an allow-listed binary present on this server? Used by preflight so a
 * deployment reports "vips is missing" at boot rather than at first import.
 *
 * @param {string} bin
 * @returns {Promise<boolean>}
 */
export async function binaryAvailable(bin) {
    try {
        await runBinary(bin, ['--version'], { timeoutMs: 5000 });
        return true;
    } catch (err) {
        // A non-zero exit still proves the binary exists; only "missing" is false.
        return err.code !== 'plugin_spawn_missing';
    }
}
