import React, { useState, useEffect } from 'react';
import { LLMService } from '../../services/llmService';

/**
 * UsageIndicator - Shows user's remaining LLM quota
 * Can be placed in header, sidebar, or chat interface
 */
export default function UsageIndicator({ compact = false }) {
    const [usage, setUsage] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadUsage();
        // Refresh usage every 30 seconds
        const interval = setInterval(loadUsage, 30000);
        return () => clearInterval(interval);
    }, []);

    const loadUsage = async () => {
        const data = await LLMService.getUsage();
        if (data) {
            setUsage(data);
        }
        setLoading(false);
    };

    if (loading || !usage) {
        return null;
    }

    // If limit is 0, it means unlimited - don't show percentage
    const isUnlimited = usage.tokensLimit === 0;
    const tokenPercent = isUnlimited ? 0 : Math.min((usage.tokensUsed / usage.tokensLimit) * 100, 100);
    const isLow = !isUnlimited && tokenPercent > 80;
    const isCritical = !isUnlimited && tokenPercent > 95;

    if (compact) {
        // Compact version for header/sidebar
        if (isUnlimited) {
            return (
                <div className="flex items-center gap-2 text-xs">
                    <span className="text-green-400">{usage.tokensUsed.toLocaleString()} tokens used</span>
                </div>
            );
        }
        return (
            <div className="flex items-center gap-2 text-xs">
                <div className="w-16 h-1.5 bg-neutral-700 rounded-full overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all ${
                            isCritical ? 'bg-red-500' : isLow ? 'bg-amber-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${tokenPercent}%` }}
                    />
                </div>
                <span className={`${isCritical ? 'text-red-400' : isLow ? 'text-amber-400' : 'text-neutral-400'}`}>
                    {usage.tokensRemaining.toLocaleString()} tokens
                </span>
            </div>
        );
    }

    // Full version with more details
    return (
        <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-3 text-sm">
            <div className="flex justify-between items-center mb-2">
                <span className="text-neutral-400">Daily Usage</span>
                <span className={`font-medium ${
                    isUnlimited ? 'text-green-400' : isCritical ? 'text-red-400' : isLow ? 'text-amber-400' : 'text-green-400'
                }`}>
                    {isUnlimited ? 'Unlimited' : `${Math.round(tokenPercent)}%`}
                </span>
            </div>
            {!isUnlimited && (
                <div className="h-2 bg-neutral-700 rounded-full overflow-hidden mb-2">
                    <div
                        className={`h-full rounded-full transition-all ${
                            isCritical ? 'bg-red-500' : isLow ? 'bg-amber-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${tokenPercent}%` }}
                    />
                </div>
            )}
            <div className="flex justify-between text-xs text-neutral-500">
                <span>{usage.tokensUsed.toLocaleString()} tokens used</span>
                {!isUnlimited && <span>{usage.tokensRemaining.toLocaleString()} remaining</span>}
            </div>
            {usage.costUsed > 0 && (
                <div className="mt-2 pt-2 border-t border-neutral-700 text-xs text-neutral-500">
                    Cost: ${usage.costUsed.toFixed(4)}{usage.costLimit > 0 ? ` / $${usage.costLimit.toFixed(2)}` : ''}
                </div>
            )}
        </div>
    );
}
