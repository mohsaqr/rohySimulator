/*
 * Brand mark — same teal/slate radial gradient as standalone/index.html
 * .brand .logo (lines 67–80 of the legacy file), reproduced with Tailwind
 * so the asset stays in one place.
 */
export function Brand({ compact = false }: { compact?: boolean } = {}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="relative size-8 shrink-0 rounded-[10px] shadow-[0_0_0_1px_var(--line-strong),_0_6px_18px_-4px_rgba(20,184,166,0.45)]"
        style={{
          background:
            'radial-gradient(circle at 30% 30%, #5eead4, #14b8a6 50%, #0f172a 100%)',
        }}
      >
        <span
          aria-hidden="true"
          className="absolute inset-2 rounded-[7px] border-[1.5px] border-white/55 border-b-transparent border-r-transparent"
          style={{ transform: 'rotate(45deg)' }}
        />
      </span>
      {compact ? (
        // Unified embed header: just the wordmark — the host already frames this
        // as Oyon, so the "Research Instrument" tagline is dropped to save space.
        <span className="text-sm font-semibold tracking-tight text-ink-0">Oyon</span>
      ) : (
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight text-ink-0">
            Oyon
          </span>
          <span className="text-[10px] uppercase tracking-[0.12em] text-ink-3">
            Research Instrument
          </span>
        </div>
      )}
    </div>
  );
}
