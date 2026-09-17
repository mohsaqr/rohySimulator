// The phone's line icons, drawn exactly as in the prototype so the handset
// reads the same. Decorative: the buttons that hold them carry the label.

const base = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
};

export function BackIcon() {
    return <svg {...base} strokeWidth="2.2"><path d="M15 18l-6-6 6-6" /></svg>;
}

export function PhoneIcon() {
    return (
        <svg {...base} strokeWidth="2">
            <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.8 2z" />
        </svg>
    );
}

export function MessageIcon() {
    return <svg {...base} strokeWidth="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z" /></svg>;
}

export function SendIcon() {
    return <svg {...base} strokeWidth="2.2"><path d="M12 19V5M5 12l7-7 7 7" /></svg>;
}

export function MicIcon() {
    return (
        <svg {...base} strokeWidth="2">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
        </svg>
    );
}

export function EndIcon() {
    return <svg {...base} strokeWidth="2.2"><path d="M18 6L6 18M6 6l12 12" /></svg>;
}

export function SpeakerIcon({ on = true }) {
    return (
        <svg {...base} strokeWidth="2">
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            {on ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /> : <path d="M22 9l-6 6M16 9l6 6" />}
        </svg>
    );
}

export function KeyboardIcon() {
    return (
        <svg {...base} strokeWidth="2">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
        </svg>
    );
}

export function CloseIcon() {
    return <svg {...base} strokeWidth="2.2"><path d="M18 6L6 18M6 6l12 12" /></svg>;
}
