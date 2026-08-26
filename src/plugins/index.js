/**
 * RPS-1 — plugin discovery.
 *
 * import.meta.glob is eager and resolved by Vite at BUILD time against the
 * directories that actually exist. That is what preserves the upstream
 * workstation's "peaceful exclusion rule" under a bundler: delete
 * src/plugins/<id>/ and rohy still builds and boots, minus that room. A static
 * import list would turn the same deletion into a build failure and take the
 * whole app down — which is exactly what the rule forbids.
 */
import { registry } from './registry.js';

const modules = import.meta.glob('./*/index.jsx', { eager: true });

Object.entries(modules).forEach(([file, mod]) => {
    const id = file.split('/')[1];
    try {
        registry.register(mod.default ?? mod);
    } catch (error) {
        // A malformed plugin is excluded and reported; it never takes rohy down.
        registry.noteLoadFailure(id, error.message);
    }
});

export { registry };
export { PluginRoom } from './PluginRoom.jsx';
export { PluginAuthor } from './PluginAuthor.jsx';
