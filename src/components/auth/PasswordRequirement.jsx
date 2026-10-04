import { CheckCircle, Circle } from 'lucide-react';

/**
 * One row of the live password checklist.
 *
 * Both states used to render the SAME filled tick and differ only by colour
 * (green vs grey), which is nothing at all to a colour-blind user and nothing
 * at all to a screen reader. So the shape changes too — a filled tick when the
 * rule is met, an empty ring when it is not — and the state is spelled out in
 * words for assistive tech. Colour is now the third channel, not the only one.
 */
export default function PasswordRequirement({ met, label, metLabel, unmetLabel }) {
    return (
        <li className="flex items-center gap-2" data-state={met ? 'met' : 'unmet'}>
            {met
                ? <CheckCircle className="w-3 h-3 text-green-500 shrink-0" aria-hidden="true" />
                : <Circle className="w-3 h-3 text-neutral-600 shrink-0" aria-hidden="true" />}
            <span className={met ? 'text-green-400' : undefined}>{label}</span>
            <span className="sr-only">{met ? metLabel : unmetLabel}</span>
        </li>
    );
}
