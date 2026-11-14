/*
 * The interpretation rules the dashboard must state (GROUP_SYNCHRONY_PLAN.md §10).
 */
export function InterpretationNote() {
  return (
    <details className="rounded border border-line bg-surface-0 p-3 text-xs text-ink-1">
      <summary className="cursor-pointer font-medium text-ink-0">How to read these numbers (5 rules)</summary>
      <p className="m-0 mt-2">
        Events first, scores second. Every measure comes from ladyna/synchrony, with its null and overlap; nothing is
        hidden, low quality is hatched.
      </p>
      <ol className="m-0 mt-2 space-y-1.5 pl-5">
        <li>
          <b>Synchrony is not collaboration quality.</b> It rises with shared stimuli, shared boredom and shared
          laughter alike; the regime sequence and the host&apos;s phase markers give it meaning, the number alone does not.
        </li>
        <li>
          <b>Webcam physiology is noisy, and heart-rate synchrony is weakly evidenced even with contact sensors.</b>{' '}
          HR is a smoothed spectral estimate with ~10 s lag (Liu 2021; Streuber 2026), so HR panels are labelled
          experimental. Respiration needs both sources to corroborate; expressions are not felt emotion, and negative
          affect rarely reaches the face (Marx 2025). Quality travels with every estimate.
        </li>
        <li>
          <b>Compare within person first.</b> Cross-person measures run on person-standardised series; absolute levels
          are reported separately.
        </li>
        <li>
          <b>Report the null and the overlap.</b> A pair with 40 % weighted overlap and z = 1.2 is not a finding. The
          exports carry both so a reviewer can check.
        </li>
        <li>
          <b>Consent is external, identity is a track.</b> Members are study-assigned member_ids, never faces; nothing
          here enrols anyone.
        </li>
      </ol>
    </details>
  );
}
