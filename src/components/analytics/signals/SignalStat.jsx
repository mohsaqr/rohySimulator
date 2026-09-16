// A stat card's value for the Text and Voice tabs: the median large, its unit
// small beside it, and the IQR plus a plain-words hint on the line underneath.

import React from 'react';
import { StatCard } from '../ui/DashboardCards.jsx';

export function SignalStat({ icon: Icon, label, value, unit = null, detail = [], accent = 'cyan', title }) {
    const lines = detail.filter(Boolean).join(' · ');
    return (
        <StatCard
            icon={<Icon className="h-5 w-5" aria-hidden="true" />}
            label={label}
            accent={accent}
            title={title}
            wrapDetail
            detail={lines || null}
            value={(
                <span className="whitespace-nowrap">
                    {value}
                    {unit && <span className="ml-1 text-sm font-medium text-gray-500">{unit}</span>}
                </span>
            )}
        />
    );
}
