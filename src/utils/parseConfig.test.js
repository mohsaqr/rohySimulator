// Run with:  npm run test:client
// Locks behaviour of the parseConfig normaliser used to coerce SQLite JSON
// strings into plain objects. Pure-function tests, no mocks.

import { describe, it, expect } from 'vitest';
import { parseConfig } from './parseConfig.js';

describe('parseConfig', () => {
    it('object input passes through by reference (no clone)', () => {
        const input = { a: 1, nested: { b: 2 } };
        const result = parseConfig(input);
        expect(result).toBe(input); // same reference, not a clone
        expect(result).toEqual({ a: 1, nested: { b: 2 } });
    });

    it('valid JSON string parses into the expected object', () => {
        expect(parseConfig('{"a":1}')).toEqual({ a: 1 });
        expect(parseConfig('{"x":"hello","y":[1,2,3]}')).toEqual({
            x: 'hello',
            y: [1, 2, 3],
        });
    });

    it('malformed JSON string returns {}', () => {
        expect(parseConfig('{not json')).toEqual({});
        expect(parseConfig('garbage')).toEqual({});
    });

    it('nested malformed JSON string returns {}', () => {
        expect(parseConfig('{"a":}')).toEqual({});
        expect(parseConfig('{"a":1,')).toEqual({});
    });

    it('empty string input returns {}', () => {
        expect(parseConfig('')).toEqual({});
    });

    it('null input returns {}', () => {
        expect(parseConfig(null)).toEqual({});
    });

    it('undefined input returns {}', () => {
        expect(parseConfig(undefined)).toEqual({});
        expect(parseConfig()).toEqual({});
    });

    it('falsy primitives (0, false) return {} because of the truthy guard', () => {
        // The source short-circuits with `if (!config) return {}`, so any
        // falsy value — including 0 and false — collapses to {}.
        expect(parseConfig(0)).toEqual({});
        expect(parseConfig(false)).toEqual({});
    });

    it('truthy number input passes through unchanged (not wrapped)', () => {
        // Non-string, truthy → returned as-is. parseConfig does not coerce.
        expect(parseConfig(42)).toBe(42);
        expect(parseConfig(3.14)).toBe(3.14);
    });

    it('truthy boolean (true) passes through unchanged', () => {
        expect(parseConfig(true)).toBe(true);
    });

    it('array input passes through by reference (not wrapped in object)', () => {
        const arr = [1, 2, 3];
        const result = parseConfig(arr);
        expect(result).toBe(arr); // same reference
        expect(Array.isArray(result)).toBe(true);
        expect(result).toEqual([1, 2, 3]);
    });

    it('valid JSON array string parses into an array (not coerced to object)', () => {
        // JSON.parse on a string is the path here — arrays come out as arrays.
        expect(parseConfig('[1,2,3]')).toEqual([1, 2, 3]);
    });

    it('JSON string of a primitive parses to that primitive', () => {
        expect(parseConfig('null')).toBe(null);
        expect(parseConfig('42')).toBe(42);
        expect(parseConfig('true')).toBe(true);
        expect(parseConfig('"hello"')).toBe('hello');
    });
});
