// Drop-in stand-in for LAILA's `<Loading />`. Local to the analytics tree
// so the copied TNA components keep their original shape (`import { Loading }
// from '../common/Loading'` is patched to `from './Loading'` at copy time).
import React from 'react';
import { Loader2 } from 'lucide-react';

export function Loading({ text, fullScreen }) {
    const inner = (
        <div className="flex flex-col items-center justify-center gap-2 text-neutral-400">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
            {text && <span className="text-xs">{text}</span>}
        </div>
    );
    if (fullScreen) {
        return <div className="flex items-center justify-center min-h-[60vh]">{inner}</div>;
    }
    return <div className="py-8 flex justify-center">{inner}</div>;
}

export default Loading;
