// How a state's name fits inside a network node. Long names used to be cut to
// eleven characters ("Patient spe…"), which hid what the state was. A name with
// a space now breaks onto two lines at the space that balances them; only a
// single long word, or a line still too long, is shortened — and the node's
// <title> always carries the full name.

const LINE_MAX = 10;

const clip = (text) => (text.length > LINE_MAX ? `${text.slice(0, LINE_MAX - 1)}…` : text);

/**
 * @param {string} label
 * @returns {{ lines: string[], fontSize: number }}
 */
export function nodeLabelLines(label) {
    const text = String(label ?? '').trim();
    if (text.length <= LINE_MAX) return { lines: [text], fontSize: text.length > 7 ? 9 : 11 };
    const spaces = [...text].map((ch, i) => (ch === ' ' ? i : -1)).filter((i) => i > 0);
    if (spaces.length === 0) return { lines: [clip(text)], fontSize: 8 };
    const best = spaces.reduce((a, b) => {
        const cost = (i) => Math.max(i, text.length - i - 1);
        return cost(b) < cost(a) ? b : a;
    });
    return { lines: [clip(text.slice(0, best)), clip(text.slice(best + 1))], fontSize: 9 };
}
