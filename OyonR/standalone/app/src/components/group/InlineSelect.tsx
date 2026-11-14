/*
 * A one-line labelled <select> for the group dashboard's toolbars: label and
 * control on one row, no card, no hint paragraph (put that in `title`).
 */
export function InlineSelect<T extends string>({ label, value, options, onChange, title }: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>;
  onChange: (v: T) => void;
  title?: string;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-ink-2" title={title}>
      <span>{label}</span>
      <select
        className="h-7 rounded border border-line bg-surface-0 px-1.5 text-xs text-ink-0"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
    </label>
  );
}
