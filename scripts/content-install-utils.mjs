import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
    createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Hash a potentially multi-gigabyte archive without holding it in memory. */
export async function sha256File(file) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}

/**
 * Extract and validate a content archive before replacing the live bundle.
 *
 * Staging is a sibling of the target so the final renames stay on one
 * filesystem. If either extraction or validation fails, the current bundle is
 * untouched. If installing the staged directory fails after the old directory
 * was moved aside, the old directory is restored before the error escapes.
 */
export function installArchiveAtomically({ archiveFile, target, plugin, contentVersion }) {
    const parent = dirname(target);
    mkdirSync(parent, { recursive: true });
    const staging = mkdtempSync(join(parent, `.${basename(target)}-install-`));
    const backup = join(parent, `.${basename(target)}-backup-${randomUUID()}`);
    let oldMoved = false;
    let installed = false;

    try {
        const tar = spawnSync('tar', ['-xzf', archiveFile, '-C', staging], { encoding: 'utf8' });
        if (tar.error) throw new Error(`tar could not start — ${tar.error.message}`);
        if (tar.status !== 0) throw new Error(`tar failed — ${String(tar.stderr || '').trim()}`);

        const stamp = join(staging, 'content.json');
        if (!existsSync(stamp)) {
            throw new Error('the archive extracted without a content.json — it is not a content bundle');
        }

        let manifest;
        try {
            manifest = JSON.parse(readFileSync(stamp, 'utf8'));
        } catch (err) {
            throw new Error(`content.json is not valid JSON — ${err.message}`);
        }
        if (manifest.plugin !== plugin) {
            throw new Error(`content.json names plugin '${manifest.plugin}', expected '${plugin}'`);
        }
        if (manifest.version !== contentVersion) {
            throw new Error(`content.json names version '${manifest.version}', expected '${contentVersion}'`);
        }

        if (existsSync(target)) {
            renameSync(target, backup);
            oldMoved = true;
        }
        try {
            renameSync(staging, target);
            installed = true;
        } catch (err) {
            if (oldMoved && !existsSync(target)) {
                renameSync(backup, target);
                oldMoved = false;
            }
            throw err;
        }

        if (oldMoved) {
            rmSync(backup, { recursive: true, force: true });
            oldMoved = false;
        }
        return manifest;
    } finally {
        if (!installed) rmSync(staging, { recursive: true, force: true });
        // Do not remove a backup if rollback itself failed: preserving the
        // operator's last good content matters more than tidying this path.
    }
}
