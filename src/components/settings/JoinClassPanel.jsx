import React, { useState } from 'react';
import { GraduationCap, Loader2 } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { ApiError } from '../../services/apiClient';
import { joinCohort } from '../../services/cohortsService';

// Minimal student self-join: enter a join code shared by a teacher.
// Lives inside UserProfilePanel so every user (incl. students) can reach it
// from the profile menu without a new top-level surface.
export default function JoinClassPanel() {
    const toast = useToast();
    const [code, setCode] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const joinCode = code.trim();
        if (!joinCode) return;
        setSubmitting(true);
        try {
            const data = await joinCohort(joinCode);
            const name = data?.cohort?.name || 'the class';
            setCode('');
            toast.success(`Joined ${name}`);
        } catch (err) {
            const msg = err instanceof ApiError
                ? (err.message || 'Could not join — check the code and try again')
                : 'Could not join — check the code and try again';
            toast.error(msg);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-6 max-w-md">
            <div className="p-4 bg-neutral-800/50 rounded-lg border border-neutral-700">
                <h3 className="text-sm font-bold text-neutral-300 mb-1 flex items-center gap-2">
                    <GraduationCap className="w-4 h-4" /> Join a class
                </h3>
                <p className="text-xs text-neutral-400">
                    Enter the join code your teacher shared with you.
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-400" htmlFor="join-class-code">
                        Join code
                    </label>
                    <input
                        id="join-class-code"
                        type="text"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="e.g. ABC123"
                        autoComplete="off"
                        className="w-full px-3 py-2.5 bg-neutral-900 border border-neutral-700 rounded-lg text-white text-sm tracking-wider focus:outline-none focus:border-blue-500"
                    />
                </div>
                <button
                    type="submit"
                    disabled={submitting || !code.trim()}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-medium text-sm flex items-center gap-2 transition-colors"
                >
                    {submitting
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <GraduationCap className="w-4 h-4" />}
                    Join class
                </button>
            </form>
        </div>
    );
}
