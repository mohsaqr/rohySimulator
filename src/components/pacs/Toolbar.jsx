import {
    Circle, Columns2, Contrast, Eclipse, FlipHorizontal2, FlipVertical2,
    Grid2x2, Move, PanelRight, RotateCcw, RotateCw, Ruler, Square, ZoomIn,
} from 'lucide-react';

/**
 * The tool ribbon. Grouped the way readers think: what the left button DOES
 * (one sticky tool), then one-shot actions on the presentation, then the
 * hanging layout. Every control carries its keyboard shortcut in the tooltip,
 * because the shortcut is the version a radiologist actually uses.
 */
export const TOOLS = [
    { id: 'window', icon: Contrast, key: 'W', label: ['radoyon_tool_window', 'Window'] },
    { id: 'zoom', icon: ZoomIn, key: 'Z', label: ['radoyon_tool_zoom', 'Zoom'] },
    { id: 'pan', icon: Move, key: 'P', label: ['radoyon_tool_pan', 'Pan'] },
    { id: 'distance', icon: Ruler, key: 'D', label: ['radoyon_tool_distance', 'Distance'] },
    { id: 'region', icon: Circle, key: 'E', label: ['radoyon_tool_region', 'Region'] },
];

export const LAYOUTS = [
    { id: '1x1', panes: 1, columns: 1, icon: Square, label: ['radoyon_layout_1', 'Single'] },
    { id: '2x1', panes: 2, columns: 2, icon: Columns2, label: ['radoyon_layout_2', 'Two across'] },
    { id: '2x2', panes: 4, columns: 2, icon: Grid2x2, label: ['radoyon_layout_4', 'Two by two'] },
];

export function Toolbar({
    tool,
    onTool,
    onAction,
    layout,
    onLayout,
    presets = [],
    activePresetId = null,
    onPreset,
    panelOpen = false,
    onTogglePanel,
    t = (key, fallback) => fallback ?? key,
}) {
    const actions = [
        { id: 'invert', icon: Eclipse, key: 'I', label: ['radoyon_invert', 'Invert'] },
        { id: 'rotate', icon: RotateCw, key: 'R', label: ['radoyon_rotate', 'Rotate 90°'] },
        { id: 'flipH', icon: FlipHorizontal2, key: 'H', label: ['radoyon_flip_h', 'Flip horizontal'] },
        { id: 'flipV', icon: FlipVertical2, key: 'V', label: ['radoyon_flip_v', 'Flip vertical'] },
        { id: 'reset', icon: RotateCcw, key: '0', label: ['radoyon_reset', 'Reset view'] },
    ];

    const button = (isActive) => `p-1.5 rounded-md border transition-colors ${
        isActive
            ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
            : 'bg-transparent border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200'
    }`;

    return (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-800 bg-slate-950">
            <div role="group" aria-label={t('radoyon_tools_label', 'Tools')} className="flex gap-0.5">
                {TOOLS.map(({ id, icon: Icon, key, label }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => onTool(id)}
                        aria-pressed={tool === id}
                        aria-label={t(...label)}
                        title={`${t(...label)} (${key})`}
                        className={button(tool === id)}
                    >
                        <Icon className="w-4 h-4" aria-hidden="true" />
                    </button>
                ))}
            </div>

            <div className="w-px h-5 bg-slate-800 mx-1" aria-hidden="true" />

            <div role="group" aria-label={t('radoyon_actions_label', 'Presentation')} className="flex gap-0.5">
                {actions.map(({ id, icon: Icon, key, label }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => onAction(id)}
                        aria-label={t(...label)}
                        title={`${t(...label)} (${key})`}
                        className={button(false)}
                    >
                        <Icon className="w-4 h-4" aria-hidden="true" />
                    </button>
                ))}
            </div>

            {presets.length > 0 && (
                <>
                    <div className="w-px h-5 bg-slate-800 mx-1" aria-hidden="true" />
                    <select
                        // Bound to the ACTIVE preset, not to a blank. A control
                        // that always reads "Presets" cannot tell you where you
                        // are, and — because re-picking the same option fires no
                        // change event — cannot take you back to one you already
                        // chose. Dragging the window lands on "Custom", which is
                        // honest and still leaves every preset one click away.
                        value={activePresetId ?? 'custom'}
                        onChange={(e) => {
                            const preset = presets.find((p) => p.id === e.target.value);
                            if (preset) onPreset(preset);
                        }}
                        aria-label={t('radoyon_presets_label', 'Window presets')}
                        className="text-xs bg-slate-900 border border-slate-700 rounded-md px-1.5 py-1 text-slate-300 hover:border-slate-500 cursor-pointer max-w-44"
                    >
                        {!activePresetId && (
                            <option value="custom" disabled>{t('radoyon_preset_custom', 'Custom')}</option>
                        )}
                        {presets.map((preset, i) => (
                            <option key={preset.id} value={preset.id} title={preset.note ?? ''}>
                                {i < 9 ? `${i + 1} · ` : ''}{preset.label} (W {preset.width}/L {preset.center})
                            </option>
                        ))}
                    </select>
                </>
            )}

            <div className="ml-auto flex items-center gap-0.5">
                <div role="group" aria-label={t('radoyon_layout_label', 'Layout')} className="flex gap-0.5">
                    {LAYOUTS.map(({ id, icon: Icon, label }) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => onLayout(id)}
                            aria-pressed={layout === id}
                            aria-label={t(...label)}
                            title={t(...label)}
                            className={button(layout === id)}
                        >
                            <Icon className="w-4 h-4" aria-hidden="true" />
                        </button>
                    ))}
                </div>
                <div className="w-px h-5 bg-slate-800 mx-1" aria-hidden="true" />
                <button
                    type="button"
                    onClick={onTogglePanel}
                    aria-pressed={panelOpen}
                    aria-label={t('radoyon_panel_label', 'Details panel')}
                    title={t('radoyon_panel_label', 'Details panel')}
                    className={button(panelOpen)}
                >
                    <PanelRight className="w-4 h-4" aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}

export default Toolbar;
