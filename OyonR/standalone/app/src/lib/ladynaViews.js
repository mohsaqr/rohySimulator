/*
 * The view contract every ladyna-backed section shares (Dynamics, Patterns):
 * a view is `{ id, title, caption, svg, note, error, file_name }` plus
 * whatever table a section adds. A ladyna/psychaj throw becomes the view's
 * `error` ({ source, code, message }) — never swallowed, never fatal to the
 * other views. No statistics here.
 */
import { createTNA, Matrix } from 'ladyna/core';

/** Classed error for inputs a section cannot use; `code` is the contract, `source` is 'oyon'. */
export class OyonViewError extends Error {
  constructor(message, code = 'oyon_view_bad_input') {
    super(message);
    this.name = 'OyonViewError';
    this.code = code;
  }
}

export function errorOf(err, source = 'ladyna') {
  return {
    source: err instanceof OyonViewError ? 'oyon' : err?.code ? 'ladyna' : source,
    code: err?.code ?? (err?.name && err.name !== 'Error' ? err.name : `${source}_error`),
    message: err?.message ?? String(err),
  };
}

export function slug(s) {
  return String(s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'figure';
}

export function view(id, title, caption, extra = {}) {
  return { id, title, caption, svg: null, note: null, error: null, file_name: `${slug(id)}.svg`, ...extra };
}

/** Run a painter; a throw becomes the view's error. */
export function paint(v, fn, source = 'ladyna') {
  try {
    return { ...v, svg: fn() };
  } catch (err) {
    return { ...v, error: errorOf(err, source) };
  }
}

/** A step that feeds several views; its throw becomes every dependent view's error. */
export function step(fn) {
  try {
    return { ok: fn(), error: null };
  } catch (err) {
    return { ok: null, error: errorOf(err) };
  }
}

/**
 * A matrix as a ladyna model the painter can draw: weights `[from][to]`,
 * uniform inits, the given labels (psychaj's VAR matrices, ladyna's transfer
 * entropy rows). Glue only — no statistics.
 */
export function matrixModel(labels, m) {
  return createTNA(Matrix.from2D(m), new Float64Array(labels.length).fill(1 / labels.length), labels.slice(), null, 'frequency');
}
