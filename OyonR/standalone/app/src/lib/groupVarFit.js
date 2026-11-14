/*
 * Group VAR networks — the fitting half (runs in a Web Worker; plain node in tests).
 *
 * Rule: NO analysis code here. The wide rows come from ladyna's `toVarRows`
 * (`ladyna/synchrony`); every coefficient comes from psychaj (`fitMlVAR`,
 * `fitGraphicalVAR`). This module only chooses the three set-ups the
 * dashboard shows, runs them, and hands back plain matrices + labels +
 * psychaj's own warnings — structured-clone safe (NaN survives postMessage),
 * so the worker can return it and the main thread paints it with ladyna
 * (`groupNetworks.js` `varNetworkViews`).
 *
 * ORIENTATION. Every matrix this module returns is `[from][to]`: row = the
 * predictor at t − 1, column = the outcome at t — what ladyna's `plotNetwork`
 * reads. psychaj's mlVAR returns `temporal[outcome][predictor]` (R mlVAR's
 * layout), so it is transposed here; graphicalVAR's `PDC` is already
 * `[predictor][outcome]`. Contemporaneous / between matrices are symmetric.
 *
 * Data policy (Oyon CLAUDE.md): nothing is withheld. A fit that throws is
 * returned with the thrower's code and message; psychaj's `warnings` pass
 * through verbatim; NaN cells (psychaj: "not estimable") stay NaN.
 */
import { toVarRows } from 'ladyna/synchrony';
import { fitMlVAR, fitGraphicalVAR } from 'psychaj';

/** Classed error for a malformed fit request; `code` is the contract. */
export class GroupVarError extends Error {
  constructor(message, code = 'group_var_bad_input') {
    super(message);
    this.name = 'GroupVarError';
    this.code = code;
  }
}

/** The three set-ups, in display order. */
export const VAR_FITS = Object.freeze(['members', 'groups', 'graphicalvar']);

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function distinct(xs) {
  return [...new Set(xs)].sort();
}

/** `[outcome][predictor]` → `[from][to]`. */
function transpose(m) {
  return m.length ? m[0].map((_, j) => m.map((row) => row[j])) : [];
}

/** ladyna's `<label>__<channel>` variable name → a display label. */
function displayLabel(name, prefix = '') {
  const cut = name.indexOf('__');
  return cut < 0 ? name : `${prefix}${name.slice(0, cut)} ${name.slice(cut + 2)}`;
}

/** Where an error came from: ladyna's classed errors carry `code`; psychaj throws plain `Error`s. */
function errorOf(err, source) {
  return {
    source: err?.code ? 'ladyna' : source,
    code: err?.code ?? (err?.name && err.name !== 'Error' ? err.name : `${source}_error`),
    message: err?.message ?? String(err),
  };
}

function baseFit(id, model, call) {
  return {
    id,
    model,
    call,
    status: 'ok',
    reason: null,
    error: null,
    vars: [],
    labels: [],
    temporal: null,
    contemporaneous: null,
    between: null,
    estimable: null,
    warnings: [],
    clusters: null,
    n_obs: null,
    n_subjects: null,
    n_rows: null,
    n_dropped: null,
    elapsed_ms: null,
  };
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Run one set-up: ladyna `toVarRows` then the psychaj fit. A throw from either
 * is returned as `status: 'error'` with its code (ladyna) or `psychaj_error`.
 */
function runFit(fit, rowsFn, fitFn) {
  const t0 = now();
  let wide;
  try {
    wide = rowsFn();
  } catch (err) {
    return { ...fit, status: 'error', error: errorOf(err, 'ladyna'), elapsed_ms: now() - t0 };
  }
  fit.vars = wide.vars;
  fit.n_rows = wide.rows.length;
  fit.n_dropped = wide.n_dropped;
  try {
    return { ...fitFn(wide, fit), elapsed_ms: now() - t0 };
  } catch (err) {
    return { ...fit, status: 'error', error: errorOf(err, 'psychaj'), elapsed_ms: now() - t0 };
  }
}

function mlvarInto(fit, res, prefix) {
  return {
    ...fit,
    labels: res.labels.map((l) => displayLabel(l, prefix)),
    temporal: transpose(res.temporal),
    contemporaneous: res.contemporaneous,
    between: res.between,
    estimable: { ...res.estimable },
    warnings: Array.isArray(res.warnings) ? res.warnings.slice() : [],
    n_obs: res.nObs,
    n_subjects: res.nSubjects,
  };
}

/**
 * Fit the dashboard's temporal + contemporaneous networks.
 *
 * - `members` — members as subjects: `toVarRows(scope rows, { channels,
 *   subject: 'member', raw: true })` → `fitMlVAR` (within-person temporal,
 *   contemporaneous, and between when psychaj can estimate it).
 * - `groups` — groups as subjects: `toVarRows(all rows, { channels, subject:
 *   'group', label: 'index', raw: true })` → `fitMlVAR` (seat-level networks;
 *   seat `#k` = the k-th member id of each group, sorted). Needs ≥ 2 groups,
 *   else `status: 'unavailable'` with the reason.
 * - `graphicalvar` — the selected group alone: `toVarRows(group rows, {
 *   channels, raw: true })` → `fitGraphicalVAR` (PDC temporal, PCC contemporaneous).
 *
 * @param {{ rows: object[], group_id: string, channels: string[], scope?: 'group'|'all' }} request
 *   `rows` = long-table rows of every group (already cut to the brushed span);
 *   `scope` = which rows the members-as-subjects fit pools (default 'group').
 * @returns {{ group_id, channels, scope, n_groups, fits: Record<'members'|'groups'|'graphicalvar', object> }}
 * @throws GroupVarError `group_var_bad_input`, `group_var_empty`, `group_var_unknown_group`
 */
export function fitVarNetworks(request) {
  if (!isObj(request)) throw new GroupVarError('`request` must be an object');
  const { rows, group_id: groupId, channels } = request;
  const scope = request.scope ?? 'group';
  if (!Array.isArray(rows)) throw new GroupVarError('`rows` must be a long-table array');
  if (rows.length === 0) throw new GroupVarError('no rows in the selected span', 'group_var_empty');
  if (!Array.isArray(channels) || channels.length === 0 || channels.some((c) => typeof c !== 'string')) {
    throw new GroupVarError('`channels` must be a non-empty array of channel names');
  }
  if (scope !== 'group' && scope !== 'all') throw new GroupVarError("`scope` must be 'group' or 'all'");
  const groupIds = distinct(rows.map((r) => r.group_id));
  if (typeof groupId !== 'string' || !groupIds.includes(groupId)) {
    throw new GroupVarError(`group '${String(groupId)}' has no rows in the span`, 'group_var_unknown_group');
  }
  const groupRows = rows.filter((r) => r.group_id === groupId);
  const scopeRows = scope === 'all' ? rows : groupRows;
  const ch = channels.slice();

  const members = runFit(
    baseFit('members', 'mlvar', `toVarRows(${scope === 'all' ? 'all groups' : groupId}, { channels, subject: 'member', raw: true }) → psychaj fitMlVAR`),
    () => toVarRows(scopeRows, { channels: ch, subject: 'member', raw: true }),
    (w, fit) => mlvarInto(fit, fitMlVAR(w.rows, { vars: w.vars, idvar: w.idvar, beepvar: w.beepvar }), ''),
  );

  let groups;
  const groupsCall = `toVarRows(all groups, { channels, subject: 'group', label: 'index', raw: true }) → psychaj fitMlVAR`;
  if (groupIds.length < 2) {
    groups = {
      ...baseFit('groups', 'mlvar', groupsCall),
      status: 'unavailable',
      reason: `groups as subjects needs at least 2 groups; the input has ${groupIds.length} (${groupIds.join(', ')}). Load a bundle with several groups doing the same task.`,
    };
  } else {
    groups = runFit(
      baseFit('groups', 'mlvar', groupsCall),
      () => toVarRows(rows, { channels: ch, subject: 'group', label: 'index', raw: true }),
      (w, fit) => {
        const out = mlvarInto(fit, fitMlVAR(w.rows, { vars: w.vars, idvar: w.idvar, beepvar: w.beepvar }), '#');
        // Seats as MCML clusters: '#k' → its channel variables (display labels).
        const clusters = {};
        out.labels.forEach((label) => {
          const seat = label.slice(0, label.indexOf(' '));
          (clusters[seat] ??= []).push(label);
        });
        return { ...out, clusters };
      },
    );
  }

  const graphicalvar = runFit(
    baseFit('graphicalvar', 'graphicalvar', `toVarRows(${groupId}, { channels, raw: true }) → psychaj fitGraphicalVAR`),
    () => toVarRows(groupRows, { channels: ch, raw: true }),
    (w, fit) => {
      const res = fitGraphicalVAR(w.rows, { vars: w.vars, idvar: w.idvar, beepvar: w.beepvar });
      return {
        ...fit,
        labels: res.labels.map((l) => displayLabel(l)),
        temporal: res.PDC,
        contemporaneous: res.PCC,
        between: null,
        // psychaj's per-matrix verdict; the temporal picture is the PDC.
        estimable: { temporal: res.estimable.PDC, contemporaneous: res.estimable.contemporaneous, between: null },
        warnings: [],
        n_obs: res.nObs,
        n_subjects: res.nSubjects,
      };
    },
  );

  return { group_id: groupId, channels: ch, scope, n_groups: groupIds.length, fits: { members, groups, graphicalvar } };
}
