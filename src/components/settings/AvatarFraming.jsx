// Reusable framing sliders. Helpers (resolveCamera, mergeCameraPatch,
// DEFAULT_CAMERA) live in src/utils/avatarFraming.js — import from there
// in non-component code.

export default function AvatarFramingSliders({ camera, onChange, onReset, hasOverride }) {
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-[11px] text-neutral-400">Framing</span>
                {hasOverride && onReset && (
                    <button
                        type="button"
                        className="text-[10px] text-neutral-500 hover:text-neutral-300"
                        onClick={onReset}
                    >
                        Reset
                    </button>
                )}
            </div>
            <Slider
                label="Distance"
                min={0.4} max={2.5} step={0.02}
                value={camera.pos[2]}
                onChange={v => onChange({ posZ: v })}
            />
            <Slider
                label="Camera height"
                min={0.5} max={2.2} step={0.01}
                value={camera.pos[1]}
                onChange={v => onChange({ posY: v })}
            />
            <Slider
                label="Look-at height"
                min={0.5} max={2.2} step={0.01}
                value={camera.lookY}
                onChange={v => onChange({ lookY: v })}
            />
            <Slider
                label="Field of view"
                min={10} max={50} step={1}
                value={camera.fov}
                onChange={v => onChange({ fov: v })}
            />
        </div>
    );
}

function Slider({ label, min, max, step, value, onChange }) {
    return (
        <div>
            <div className="flex items-center justify-between text-[10px] text-neutral-500">
                <span>{label}</span>
                <span className="font-mono">{Number(value).toFixed(step >= 1 ? 0 : 2)}</span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={e => onChange(Number(e.target.value))}
                className="w-full"
            />
        </div>
    );
}
