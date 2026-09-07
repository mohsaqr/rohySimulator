import {
  PATIENT_FIGURE_HEIGHT,
  PATIENT_FIGURE_MASK,
  PATIENT_FIGURE_WIDTH,
} from '../patientFigure.js';
import {
  FRONTAL_LEADS,
  LEAD_ANATOMY_KEYS,
  LIMB_ELECTRODES,
  LIMB_ELECTRODE_KEYS,
  PRECORDIAL_POSITIONS,
  TERRITORY_KEYS,
  TERRITORY_LABELS,
  frontal_lead_endpoint,
  lead_topography,
} from '../leadTopography.js';
import { identity_t } from '../i18n.js';

const HEXAXIAL = Object.freeze({ center_x: 50, center_y: 50, radius: 33 });

/** Keyboard activation for an SVG target, which gets none for free. */
const activate_on_key = (on_activate) => (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  on_activate();
};

function PatientFigure({ t }) {
  return (
    <g className="ecg-manikin-body" aria-hidden="true">
      {/* The figure is stored as ink coverage, so the panel paints it with its
          own colour through currentColor rather than the asset carrying one. */}
      <defs>
        <mask id="ecg-patient-figure-mask" maskUnits="userSpaceOnUse"
          x="0" y="0" width={PATIENT_FIGURE_WIDTH} height={PATIENT_FIGURE_HEIGHT}>
          <image href={PATIENT_FIGURE_MASK} x="0" y="0"
            width={PATIENT_FIGURE_WIDTH} height={PATIENT_FIGURE_HEIGHT} />
        </mask>
      </defs>
      <rect x="0" y="0" width={PATIENT_FIGURE_WIDTH} height={PATIENT_FIGURE_HEIGHT}
        fill="currentColor" mask="url(#ecg-patient-figure-mask)" />
      {/* Landmarks a reader is expected to find on a real chest, drawn faintly
          so they orient the electrodes without becoming the picture. */}
      <line className="ecg-manikin-landmark" x1="113" y1="70" x2="113" y2="150" />
      <line className="ecg-manikin-landmark" x1="88" y1="128" x2="172" y2="128" />
      <line className="ecg-manikin-landmark" x1="88" y1="140" x2="172" y2="140" />
      <text className="ecg-manikin-landmark-label" x="85" y="130.5">{t('intercostal_fourth', '4th')}</text>
      <text className="ecg-manikin-landmark-label" x="85" y="142.5">{t('intercostal_fifth', '5th')}</text>
    </g>
  );
}

/**
 * Horizontal position of each lead's label chip.
 *
 * V3 to V6 sit 9–11 px apart on a 232 px chest, so labels drawn on the dots
 * collide and the reader loses exactly the leads that are hardest to place.
 * Anatomy stays exact and the labels fan out below the chest on leader lines,
 * which is how placement diagrams have always solved it.
 */
const LABEL_ROW_Y = 178;
const LABEL_X = Object.freeze({ V1: 92, V2: 110, V3: 128, V4: 146, V5: 164, V6: 182 });

function ElectrodeTarget({ position, selected, note_count, on_select, t }) {
  const { lead, x, y, anatomy } = position;
  const label = `${t('lead', 'Lead')} ${lead} — ${t(LEAD_ANATOMY_KEYS[lead], anatomy)}`;
  const label_x = LABEL_X[lead];
  return (
    <g
      className={`ecg-lead-target${selected ? ' is-selected' : ''}`}
      role="radio"
      aria-checked={selected}
      aria-label={label}
      tabIndex={selected ? 0 : -1}
      onClick={() => on_select(lead)}
      onKeyDown={activate_on_key(() => on_select(lead))}
    >
      <title>{label}</title>
      <line className="ecg-lead-leader" x1={x} y1={y} x2={label_x} y2={LABEL_ROW_Y - 7} />
      <circle className="ecg-lead-target-halo" cx={x} cy={y} r="7.5" />
      <circle className="ecg-lead-target-dot" cx={x} cy={y} r="4.4" />
      <g className="ecg-lead-chip">
        <rect x={label_x - 8.5} y={LABEL_ROW_Y - 6.5} width="17" height="13" rx="3.5" />
        <text x={label_x} y={LABEL_ROW_Y + 2.6}>{lead}</text>
      </g>
      {note_count > 0 && (
        <>
          <circle className="ecg-lead-target-notes" cx={label_x + 8} cy={LABEL_ROW_Y - 6} r="4" />
          <text className="ecg-lead-target-notes-text" x={label_x + 8} y={LABEL_ROW_Y - 4.2}>{note_count}</text>
        </>
      )}
    </g>
  );
}

function LimbElectrode({ electrode, t }) {
  return (
    <g className={`ecg-manikin-electrode${electrode.ground ? ' is-ground' : ''}`} aria-hidden="true">
      <title>{t(LIMB_ELECTRODE_KEYS[electrode.electrode], electrode.label)}</title>
      <circle cx={electrode.x} cy={electrode.y} r="7" />
      <text x={electrode.x} y={electrode.y + 2.5}>{electrode.electrode}</text>
    </g>
  );
}

function FrontalTarget({ lead, selected, note_count, on_select, t }) {
  const { x, y, angle_degrees } = frontal_lead_endpoint(lead, HEXAXIAL);
  const label = `${t('lead', 'Lead')} ${lead} — ${angle_degrees > 0 ? '+' : ''}${angle_degrees} `
    + `${t('degrees_in_frontal_plane', 'degrees in the frontal plane')}`;
  return (
    <g
      className={`ecg-lead-target ecg-lead-target-frontal${selected ? ' is-selected' : ''}`}
      role="radio"
      aria-checked={selected}
      aria-label={label}
      tabIndex={selected ? 0 : -1}
      onClick={() => on_select(lead)}
      onKeyDown={activate_on_key(() => on_select(lead))}
    >
      <title>{label}</title>
      <line className="ecg-hexaxial-axis" x1={HEXAXIAL.center_x} y1={HEXAXIAL.center_y} x2={x} y2={y} />
      <circle className="ecg-lead-target-halo" cx={x} cy={y} r="7.4" />
      <circle className="ecg-lead-target-dot" cx={x} cy={y} r="5.2" />
      <text className="ecg-lead-target-text" x={x} y={y + 1.6}>{lead}</text>
      {note_count > 0 && (
        <>
          <circle className="ecg-lead-target-notes" cx={x + 5.4} cy={y - 5.4} r="2.8" />
          <text className="ecg-lead-target-notes-text" x={x + 5.4} y={y - 4.4}>{note_count}</text>
        </>
      )}
    </g>
  );
}

/**
 * Choose a lead by pointing at where it comes from.
 *
 * A dropdown of twelve strings hides the one thing a learner most needs to
 * internalise: that V1–V6 are positions on a chest and I–aVF are directions
 * through a plane. So the chest leads are placed on a figure at their real
 * landmarks, and the frontal leads sit on the hexaxial circle at their real
 * angles. Selecting is the same act either way; only the picture differs,
 * because the anatomy differs.
 *
 * @param {object} props component props
 * @param {string} props.value currently focused lead
 * @param {(lead: string) => void} props.on_change selection handler
 * @param {Record<string, number>} [props.note_counts] notes anchored per lead
 * @param {(key: string, fallback?: string, values?: object) => string} [props.t] host translator
 * @returns {JSX.Element} the selector
 */
export function LeadSelector({
  value = 'II',
  on_change,
  note_counts = {},
  t = identity_t,
}) {
  if (typeof on_change !== 'function') throw new TypeError('LeadSelector: on_change must be a function');
  const topography = lead_topography(value);
  const territory = topography.territory
    ? t(TERRITORY_KEYS[topography.territory], TERRITORY_LABELS[topography.territory])
    : null;
  // A frontal lead's origin is a derivation, an angle and a plane. The angle is
  // a number, so the sentence is rebuilt from its translated parts here rather
  // than shipped pre-glued from `lead_topography()`.
  const anatomy = topography.kind === 'frontal'
    ? `${t(topography.anatomy_key, topography.derivation)} · `
      + `${topography.angle_degrees > 0 ? '+' : ''}${topography.angle_degrees}° `
      + `${t('in_the_frontal_plane', 'in the frontal plane')}`
    : t(topography.anatomy_key, topography.anatomy);

  return (
    <section className="ecg-lead-selector" aria-label={t('lead_selection', 'Lead selection by anatomy')}>
      <div className="ecg-lead-selector-charts">
        <figure className="ecg-lead-selector-figure">
          <figcaption>{t('chest_electrodes', 'Chest electrodes')}</figcaption>
          <svg
            viewBox={`0 0 ${PATIENT_FIGURE_WIDTH} ${PATIENT_FIGURE_HEIGHT}`}
            className="ecg-manikin"
            role="radiogroup"
            aria-label={t('precordial_leads_group', 'Precordial leads by electrode position')}
          >
            <PatientFigure t={t} />
            {LIMB_ELECTRODES.map((electrode) => (
              <LimbElectrode key={electrode.electrode} electrode={electrode} t={t} />
            ))}
            {PRECORDIAL_POSITIONS.map((position) => (
              <ElectrodeTarget
                key={position.lead}
                position={position}
                selected={position.lead === value}
                note_count={note_counts[position.lead] ?? 0}
                on_select={on_change}
                t={t}
              />
            ))}
          </svg>
        </figure>

        <figure className="ecg-lead-selector-figure">
          <figcaption>{t('frontal_plane', 'Frontal plane')}</figcaption>
          <svg
            viewBox="0 0 100 100"
            className="ecg-hexaxial"
            role="radiogroup"
            aria-label={t('frontal_leads_group', 'Frontal leads by hexaxial angle')}
          >
            <circle
              className="ecg-hexaxial-ring"
              cx={HEXAXIAL.center_x}
              cy={HEXAXIAL.center_y}
              r={HEXAXIAL.radius}
            />
            <circle className="ecg-hexaxial-hub" cx={HEXAXIAL.center_x} cy={HEXAXIAL.center_y} r="1.6" />
            {FRONTAL_LEADS.map((lead) => (
              <FrontalTarget
                key={lead}
                lead={lead}
                selected={lead === value}
                note_count={note_counts[lead] ?? 0}
                on_select={on_change}
                t={t}
              />
            ))}
          </svg>
        </figure>
      </div>

      <p className="ecg-lead-selector-caption">
        <strong>{value}</strong>
        <span>{anatomy}</span>
        {territory && <span className={`ecg-territory ecg-territory-${topography.territory}`}>{territory}</span>}
      </p>
    </section>
  );
}

export default LeadSelector;
