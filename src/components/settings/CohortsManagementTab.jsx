import React, { useCallback, useEffect, useState } from 'react';
import {
    Users, Plus, Trash2, Pencil, ArrowLeft, KeyRound, Copy,
    Check, Loader2, UserPlus, X,
} from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { ApiError } from '../../services/apiClient';
import { roleLabel } from '../../constants/roleLabels';
import {
    listCohorts, getCohort, createCohort, renameCohort, deleteCohort,
    addCohortMember, removeCohortMember, rotateJoinCode, disableJoinCode,
} from '../../services/cohortsService';
import CohortReports from './CohortReports';

// Teacher / admin cohort ("class") management. Teachers manage their own
// cohorts; admins see all (server enforces — this UI just renders whatever
// GET /cohorts returns for the caller).
export default function CohortsManagementTab() {
    const toast = useToast();
    const [cohorts, setCohorts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [openId, setOpenId] = useState(null); // roster drill-down

    const errMsg = (e, fallback) =>
        e instanceof ApiError ? (e.message || fallback) : fallback;

    const loadCohorts = useCallback(async () => {
        setLoading(true);
        try {
            const data = await listCohorts();
            setCohorts(data.cohorts || []);
        } catch (e) {
            toast.error(errMsg(e, 'Failed to load classes'));
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { loadCohorts(); }, [loadCohorts]);

    const handleCreate = async (e) => {
        e.preventDefault();
        const name = newName.trim();
        if (!name) return;
        setCreating(true);
        try {
            await createCohort(name);
            setNewName('');
            toast.success(`Class "${name}" created`);
            await loadCohorts();
        } catch (err) {
            toast.error(errMsg(err, 'Failed to create class'));
        } finally {
            setCreating(false);
        }
    };

    const handleRename = async (cohort) => {
        const next = window.prompt('Rename class', cohort.name);
        if (next == null) return;
        const name = next.trim();
        if (!name || name === cohort.name) return;
        try {
            await renameCohort(cohort.id, name);
            toast.success('Class renamed');
            await loadCohorts();
        } catch (err) {
            toast.error(errMsg(err, 'Failed to rename class'));
        }
    };

    const handleDelete = async (cohort) => {
        const ok = await toast.confirm(
            `Delete "${cohort.name}"? This removes the class grouping and its members' access to it. Members' accounts and their own data are not affected.`,
            { title: 'Delete class', confirmText: 'Delete', type: 'danger' },
        );
        if (!ok) return;
        try {
            await deleteCohort(cohort.id);
            toast.success('Class deleted');
            if (openId === cohort.id) setOpenId(null);
            await loadCohorts();
        } catch (err) {
            toast.error(errMsg(err, 'Failed to delete class'));
        }
    };

    if (openId != null) {
        return (
            <CohortRoster
                cohortId={openId}
                onBack={() => { setOpenId(null); loadCohorts(); }}
            />
        );
    }

    return (
        <div className="max-w-3xl">
            <div className="flex items-center gap-2 mb-1">
                <Users className="w-5 h-5 text-purple-400" />
                <h3 className="text-lg font-bold">Classes</h3>
            </div>
            <p className="text-sm text-neutral-400 mb-6">
                Group students into classes. Students join with a join code
                under My Profile → Join a class.
            </p>

            <form onSubmit={handleCreate} className="flex gap-2 mb-8">
                <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="New class name"
                    className="flex-1 px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                />
                <button
                    type="submit"
                    disabled={creating || !newName.trim()}
                    className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg font-medium text-sm flex items-center gap-2 transition-colors"
                >
                    {creating
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Plus className="w-4 h-4" />}
                    Create
                </button>
            </form>

            {loading ? (
                <div className="flex items-center justify-center h-32 text-neutral-500">
                    <Loader2 className="w-5 h-5 animate-spin" />
                </div>
            ) : cohorts.length === 0 ? (
                <p className="text-sm text-neutral-500">No classes yet. Create one above.</p>
            ) : (
                <div className="space-y-2">
                    {cohorts.map((c) => (
                        <div
                            key={c.id}
                            className="flex items-center gap-3 p-4 bg-neutral-800/50 border border-neutral-700 rounded-lg"
                        >
                            <button
                                onClick={() => setOpenId(c.id)}
                                className="flex-1 text-left"
                            >
                                <div className="font-bold text-white">{c.name}</div>
                                <div className="text-xs text-neutral-400 mt-0.5">
                                    {c.member_count ?? 0} member{(c.member_count ?? 0) === 1 ? '' : 's'}
                                    {' · '}
                                    {c.join_code ? 'join code active' : 'no join code'}
                                </div>
                            </button>
                            <button
                                onClick={() => handleRename(c)}
                                title="Rename"
                                className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors"
                            >
                                <Pencil className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => handleDelete(c)}
                                title="Delete"
                                className="p-2 text-neutral-400 hover:text-red-400 hover:bg-neutral-700 rounded-lg transition-colors"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// Roster + join-code management for a single cohort.
function CohortRoster({ cohortId, onBack }) {
    const toast = useToast();
    const [cohort, setCohort] = useState(null);
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [identifier, setIdentifier] = useState('');
    const [adding, setAdding] = useState(false);
    const [copied, setCopied] = useState(false);
    const [busyCode, setBusyCode] = useState(false);
    const [section, setSection] = useState('manage'); // 'manage' | 'reports'

    const errMsg = (e, fallback) =>
        e instanceof ApiError ? (e.message || fallback) : fallback;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getCohort(cohortId);
            setCohort(data.cohort || null);
            setMembers(data.members || []);
        } catch (e) {
            toast.error(errMsg(e, 'Failed to load class'));
        } finally {
            setLoading(false);
        }
    }, [cohortId, toast]);

    useEffect(() => { load(); }, [load]);

    const handleAdd = async (e) => {
        e.preventDefault();
        const id = identifier.trim();
        if (!id) return;
        setAdding(true);
        try {
            await addCohortMember(cohortId, id);
            setIdentifier('');
            toast.success('Member added');
            await load();
        } catch (err) {
            toast.error(errMsg(err, 'Failed to add member'));
        } finally {
            setAdding(false);
        }
    };

    const handleRemove = async (m) => {
        const ok = await toast.confirm(
            `Remove ${m.username || m.name} from this class?`,
            { title: 'Remove member', confirmText: 'Remove', type: 'danger' },
        );
        if (!ok) return;
        try {
            await removeCohortMember(cohortId, m.id);
            toast.success('Member removed');
            await load();
        } catch (err) {
            toast.error(errMsg(err, 'Failed to remove member'));
        }
    };

    const handleRotate = async () => {
        setBusyCode(true);
        try {
            const data = await rotateJoinCode(cohortId);
            setCohort((c) => (c ? { ...c, join_code: data.join_code } : c));
            toast.success('Join code generated');
        } catch (err) {
            toast.error(errMsg(err, 'Failed to generate join code'));
        } finally {
            setBusyCode(false);
        }
    };

    const handleDisableCode = async () => {
        setBusyCode(true);
        try {
            await disableJoinCode(cohortId);
            setCohort((c) => (c ? { ...c, join_code: null } : c));
            toast.success('Join code disabled');
        } catch (err) {
            toast.error(errMsg(err, 'Failed to disable join code'));
        } finally {
            setBusyCode(false);
        }
    };

    const handleCopy = async () => {
        if (!cohort?.join_code) return;
        try {
            await navigator.clipboard.writeText(cohort.join_code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error('Could not copy to clipboard');
        }
    };

    return (
        <div className="max-w-3xl">
            <button
                onClick={onBack}
                className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white mb-4 transition-colors"
            >
                <ArrowLeft className="w-4 h-4" /> Back to classes
            </button>

            {loading ? (
                <div className="flex items-center justify-center h-32 text-neutral-500">
                    <Loader2 className="w-5 h-5 animate-spin" />
                </div>
            ) : !cohort ? (
                <p className="text-sm text-neutral-500">Class not found.</p>
            ) : (
                <>
                    <h3 className="text-lg font-bold mb-4">{cohort.name}</h3>

                    {/* Manage (Phase-3b) vs read-only Reports (Phase-5). The
                        management body below is unchanged — it just no longer
                        renders while the Reports section is active. */}
                    <div className="flex gap-1 mb-6">
                        {[
                            { id: 'manage', label: 'Manage' },
                            { id: 'reports', label: 'Reports' },
                        ].map((s) => (
                            <button
                                key={s.id}
                                onClick={() => setSection(s.id)}
                                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                    section === s.id
                                        ? 'bg-neutral-700 text-white'
                                        : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                                }`}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>

                    {section === 'reports' && (
                        <CohortReports cohortId={cohortId} />
                    )}

                    {section === 'manage' && (
                    <>
                    {/* Join code — semi-sensitive: only shown to the owner/admin
                        the API returned it to. Sharing it lets students self-join. */}
                    <div className="p-4 bg-neutral-800/50 border border-neutral-700 rounded-lg mb-8">
                        <div className="flex items-center gap-2 mb-2">
                            <KeyRound className="w-4 h-4 text-purple-400" />
                            <span className="text-sm font-bold text-neutral-200">Join code</span>
                        </div>
                        {cohort.join_code ? (
                            <div className="flex items-center gap-2">
                                <code className="px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-purple-300 font-mono text-sm tracking-wider">
                                    {cohort.join_code}
                                </code>
                                <button
                                    onClick={handleCopy}
                                    title="Copy join code"
                                    className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors"
                                >
                                    {copied
                                        ? <Check className="w-4 h-4 text-green-400" />
                                        : <Copy className="w-4 h-4" />}
                                </button>
                                <button
                                    onClick={handleRotate}
                                    disabled={busyCode}
                                    className="px-3 py-2 bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
                                >
                                    Rotate
                                </button>
                                <button
                                    onClick={handleDisableCode}
                                    disabled={busyCode}
                                    className="px-3 py-2 bg-neutral-700 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
                                >
                                    Disable
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={handleRotate}
                                disabled={busyCode}
                                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                            >
                                {busyCode
                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                    : <KeyRound className="w-4 h-4" />}
                                Generate join code
                            </button>
                        )}
                        <p className="text-xs text-neutral-500 mt-2">
                            Students enter this under My Profile → Join a class.
                            Anyone with this code can join — rotate or disable it
                            if it leaks.
                        </p>
                    </div>

                    {/* Add member */}
                    <form onSubmit={handleAdd} className="flex gap-2 mb-6">
                        <input
                            type="text"
                            value={identifier}
                            onChange={(e) => setIdentifier(e.target.value)}
                            placeholder="Add member by username or email"
                            className="flex-1 px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                        <button
                            type="submit"
                            disabled={adding || !identifier.trim()}
                            className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg font-medium text-sm flex items-center gap-2 transition-colors"
                        >
                            {adding
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <UserPlus className="w-4 h-4" />}
                            Add
                        </button>
                    </form>

                    {/* Roster */}
                    {members.length === 0 ? (
                        <p className="text-sm text-neutral-500">No members yet.</p>
                    ) : (
                        <div className="space-y-2">
                            {members.map((m) => (
                                <div
                                    key={m.id}
                                    className="flex items-center gap-3 p-3 bg-neutral-800/50 border border-neutral-700 rounded-lg"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-white truncate">
                                            {m.name || m.username}
                                        </div>
                                        <div className="text-xs text-neutral-400 truncate">
                                            {m.username}
                                            {m.role ? ` · ${roleLabel(m.role)}` : ''}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleRemove(m)}
                                        title="Remove member"
                                        className="p-2 text-neutral-400 hover:text-red-400 hover:bg-neutral-700 rounded-lg transition-colors"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    </>
                    )}
                </>
            )}
        </div>
    );
}
