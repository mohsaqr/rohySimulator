import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LLMService } from '../../services/llmService';
import { formatNumber } from '../../utils/formatters';

/**
 * UsageIndicator - Shows user's remaining LLM quota
 * Can be placed in header, sidebar, or chat interface
 */
export default function UsageIndicator({ compact = false }) {
    const { t } = useTranslation('common');
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
                    <span className="text-green-400">{t('tokens_used', { count: formatNumber(usage.tokensUsed) })}</span>
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
                    {t('tokens_count', { count: formatNumber(usage.tokensRemaining) })}
                </span>
            </div>
        );
    }

    // Full version with more details
    return (
        <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-3 text-sm">
            <div className="flex justify-between items-center mb-2">
                <span className="text-neutral-400">{t('daily_usage')}</span>
                <span className={`font-medium ${
                    isUnlimited ? 'text-green-400' : isCritical ? 'text-red-400' : isLow ? 'text-amber-400' : 'text-green-400'
                }`}>
                    {isUnlimited ? t('unlimited') : `${Math.round(tokenPercent)}%`}
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
                <span>{t('tokens_used', { count: formatNumber(usage.tokensUsed) })}</span>
                {!isUnlimited && <span>{t('tokens_remaining', { count: formatNumber(usage.tokensRemaining) })}</span>}
            </div>
            {usage.costUsed > 0 && (
                <div className="mt-2 pt-2 border-t border-neutral-700 text-xs text-neutral-500">
                    {usage.costLimit > 0
                        ? t('cost_used_with_limit', { amount: `$${usage.costUsed.toFixed(4)}`, limit: `$${usage.costLimit.toFixed(2)}` })
                        : t('cost_used', { amount: `$${usage.costUsed.toFixed(4)}` })}
                </div>
            )}
        </div>
    );
}
