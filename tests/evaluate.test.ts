import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    applyOperator,
    evaluateFilterTree,
    MAX_FILTER_DEPTH,
    MAX_PATTERN_LENGTH,
    type FilterNode,
    type OperatorType,
} from '../src/index.js';

// Minimal expect-style helpers on top of node:assert (keeps the suite free of test-runner dependencies).
const expect = (actual: unknown) => ({
    toBe: (expected: unknown) => assert.equal(actual, expected),
    not: { toThrow: () => assert.doesNotThrow(actual as () => unknown) },
});
const cond = (columnKey: string | number, operator: OperatorType, value?: unknown): FilterNode =>
    value === undefined
        ? ({ type: 'condition', columnKey, operator } as FilterNode)
        : { type: 'condition', columnKey, operator, value };
const and = (...filters: FilterNode[]): FilterNode => ({ type: 'group', operator: 'and', filters });
const or = (...filters: FilterNode[]): FilterNode => ({ type: 'group', operator: 'or', filters });
const ci = { caseInsensitive: true };
const cs = { caseInsensitive: false };

describe('equality', () => {
    it('is strict about types', () => {
        expect(applyOperator(3, '=', 3, cs)).toBe(true);
        expect(applyOperator(3, '=', '3', cs)).toBe(false);
        expect(applyOperator(3, '!=', '3', cs)).toBe(true);
    });
    it('folds case only when caseInsensitive', () => {
        expect(applyOperator('ABC', '=', 'abc', cs)).toBe(false);
        expect(applyOperator('ABC', '=', 'abc', ci)).toBe(true);
        expect(applyOperator('ABC', '!=', 'abc', ci)).toBe(false);
    });
    it('= "" matches empty-string cells', () => {
        expect(applyOperator('', '=', '', cs)).toBe(true);
    });
});

describe('relational operators', () => {
    it('never match blank cells', () => {
        for (const blank of [null, undefined, '']) {
            for (const op of ['<', '<=', '>', '>='] as OperatorType[]) {
                expect(applyOperator(blank, op, 5, cs)).toBe(false);
            }
        }
    });
    it('compare numeric strings as numbers', () => {
        expect(applyOperator('10', '<', '9', cs)).toBe(false);
        expect(applyOperator('10', '>', 9, cs)).toBe(true);
        expect(applyOperator(10, '>=', '10', cs)).toBe(true);
    });
    it('compare non-numeric strings as strings', () => {
        expect(applyOperator('b', '>', 'a', cs)).toBe(true);
        expect(applyOperator('B', '>', 'a', ci)).toBe(true);
        expect(applyOperator('B', '>', 'a', cs)).toBe(false);
    });
    it('compare Date cells with Date, ISO string or epoch bounds', () => {
        const d = new Date('2025-01-02T00:00:00Z');
        expect(applyOperator(d, '>=', '2025-01-01', cs)).toBe(true);
        expect(applyOperator(d, '<', new Date('2025-01-01'), cs)).toBe(false);
        expect(applyOperator(d, '>', Date.parse('2025-01-01'), cs)).toBe(true);
        expect(applyOperator(d, '>', 'not a date', cs)).toBe(false);
    });
    it('do not match incomparable types', () => {
        expect(applyOperator('abc', '<', 5, cs)).toBe(false);
        expect(applyOperator(true, '>', 0, cs)).toBe(false);
        expect(applyOperator({}, '>', 0, cs)).toBe(false);
    });
});

describe('between / notBetween', () => {
    it('includes both bounds', () => {
        expect(applyOperator(5, 'between', [5, 10], cs)).toBe(true);
        expect(applyOperator(10, 'between', [5, 10], cs)).toBe(true);
        expect(applyOperator(11, 'between', [5, 10], cs)).toBe(false);
        expect(applyOperator(11, 'notBetween', [5, 10], cs)).toBe(true);
        expect(applyOperator(7, 'notBetween', [5, 10], cs)).toBe(false);
    });
    it('never match blank cells', () => {
        expect(applyOperator(null, 'between', [-5, 5], cs)).toBe(false);
        expect(applyOperator('', 'between', [-5, 5], cs)).toBe(false);
        expect(applyOperator(null, 'notBetween', [1, 5], cs)).toBe(false);
    });
    it('compare numeric string bounds as numbers', () => {
        expect(applyOperator(5, 'between', ['2', '10'], cs)).toBe(true);
        expect(applyOperator('50', 'between', ['2', '10'], cs)).toBe(false);
    });
    it('reject malformed ranges and blank bounds', () => {
        expect(applyOperator(5, 'between', 5, cs)).toBe(false);
        expect(applyOperator(5, 'between', [1, 2, 3], cs)).toBe(false);
        expect(applyOperator(5, 'between', ['', 10], cs)).toBe(false);
    });
    it('work with dates', () => {
        const d = new Date('2025-06-15');
        expect(applyOperator(d, 'between', ['2025-01-01', '2025-12-31'], cs)).toBe(true);
    });
});

describe('in / notIn', () => {
    it('require an array', () => {
        expect(applyOperator('x', 'in', ['x', 'y'], cs)).toBe(true);
        expect(applyOperator('x', 'in', 'x', cs)).toBe(false);
        expect(applyOperator('x', 'notIn', 'x', cs)).toBe(false);
        expect(applyOperator('z', 'notIn', ['x', 'y'], cs)).toBe(true);
    });
    it('respect caseInsensitive', () => {
        expect(applyOperator('ABC', 'in', ['abc'], cs)).toBe(false);
        expect(applyOperator('ABC', 'in', ['abc'], ci)).toBe(true);
        expect(applyOperator('ABC', 'notIn', ['abc'], ci)).toBe(false);
    });
    it('are type-strict', () => {
        expect(applyOperator(3, 'in', ['3'], cs)).toBe(false);
        expect(applyOperator(3, 'in', [3], cs)).toBe(true);
    });
});

describe('null / empty / boolean', () => {
    it('isNull / isNotNull', () => {
        expect(applyOperator(null, 'isNull', undefined, cs)).toBe(true);
        expect(applyOperator(undefined, 'isNull', undefined, cs)).toBe(true);
        expect(applyOperator('', 'isNull', undefined, cs)).toBe(false);
        expect(applyOperator(0, 'isNotNull', undefined, cs)).toBe(true);
    });
    it('empty / notEmpty', () => {
        expect(applyOperator('', 'empty', undefined, cs)).toBe(true);
        expect(applyOperator([], 'empty', undefined, cs)).toBe(true);
        expect(applyOperator(0, 'empty', undefined, cs)).toBe(false);
        expect(applyOperator('x', 'notEmpty', undefined, cs)).toBe(true);
    });
    it('isTrue / isFalse are strict', () => {
        expect(applyOperator(true, 'isTrue', undefined, cs)).toBe(true);
        expect(applyOperator(1, 'isTrue', undefined, cs)).toBe(false);
        expect(applyOperator(false, 'isFalse', undefined, cs)).toBe(true);
    });
});

describe('string operators', () => {
    it('work on strings only, with caseInsensitive', () => {
        expect(applyOperator('Hello', 'contains', 'ell', cs)).toBe(true);
        expect(applyOperator('Hello', 'contains', 'ELL', ci)).toBe(true);
        expect(applyOperator('Hello', 'startsWith', 'he', ci)).toBe(true);
        expect(applyOperator('Hello', 'endsWith', 'LO', cs)).toBe(false);
        expect(applyOperator('Hello', 'doesNotContain', 'x', cs)).toBe(true);
        expect(applyOperator(null, 'doesNotContain', 'x', cs)).toBe(false);
        expect(applyOperator(123, 'contains', '2', cs)).toBe(false);
    });
});

describe('matches', () => {
    it('accepts string patterns (JSON-safe)', () => {
        expect(applyOperator('abc', 'matches', 'a.c', cs)).toBe(true);
        expect(applyOperator('abc', 'matches', '^b', cs)).toBe(false);
        expect(applyOperator('ABC', 'matches', 'a.c', cs)).toBe(false);
        expect(applyOperator('ABC', 'matches', 'a.c', ci)).toBe(true);
    });
    it('works after a JSON round trip of the tree', () => {
        const tree = JSON.parse(JSON.stringify(cond('a', 'matches', '^ab')));
        expect(evaluateFilterTree(tree, { a: 'abc' })).toBe(true);
    });
    it('still accepts RegExp instances, including stateful ones', () => {
        const g = /a/g;
        expect(applyOperator('a', 'matches', g, cs)).toBe(true);
        expect(applyOperator('a', 'matches', g, cs)).toBe(true);
    });
    it('rejects invalid, empty and over-long patterns', () => {
        expect(applyOperator('abc', 'matches', '(', cs)).toBe(false);
        expect(applyOperator('abc', 'matches', '', cs)).toBe(false);
        expect(applyOperator('a', 'matches', 'a'.repeat(MAX_PATTERN_LENGTH + 1), cs)).toBe(false);
        expect(applyOperator('abc', 'matches', {}, cs)).toBe(false);
        expect(applyOperator(5, 'matches', '5', cs)).toBe(false);
    });
});

describe('applyOperator', () => {
    it('unknown operators never match', () => {
        expect(applyOperator(1, 'foo' as OperatorType, 1, cs)).toBe(false);
    });
    it('options default to case-sensitive', () => {
        expect(applyOperator('A', '=', 'a')).toBe(false);
    });
});

describe('evaluateFilterTree', () => {
    const row = { a: 1, b: 'x', c: null };

    it('combines and / or', () => {
        expect(evaluateFilterTree(and(cond('a', '=', 1), cond('b', '=', 'x')), row)).toBe(true);
        expect(evaluateFilterTree(and(cond('a', '=', 1), cond('b', '=', 'y')), row)).toBe(false);
        expect(evaluateFilterTree(or(cond('a', '=', 2), cond('b', '=', 'x')), row)).toBe(true);
        expect(evaluateFilterTree(or(cond('a', '=', 2), cond('b', '=', 'y')), row)).toBe(false);
    });
    it('passes caseInsensitive through', () => {
        expect(evaluateFilterTree(cond('b', '=', 'X'), row, ci)).toBe(true);
        expect(evaluateFilterTree(cond('b', '=', 'X'), row)).toBe(false);
    });
    it('unwraps { value } cells', () => {
        expect(evaluateFilterTree(cond('a', '=', 'x'), { a: { value: 'x' } })).toBe(true);
    });
    it('accepts nodes without type', () => {
        expect(evaluateFilterTree({ columnKey: 'a', operator: '=', value: 1 } as FilterNode, row)).toBe(true);
        expect(evaluateFilterTree({ operator: 'and', filters: [cond('a', '=', 2)] } as unknown as FilterNode, row)).toBe(false);
    });

    describe('value-less operators', () => {
        it('evaluate conditions without a value key', () => {
            expect(evaluateFilterTree(cond('a', 'isNull'), row)).toBe(false);
            expect(evaluateFilterTree(cond('c', 'isNull'), row)).toBe(true);
            expect(evaluateFilterTree(cond('a', 'isNotNull'), row)).toBe(true);
        });
        it('survive JSON dropping value: undefined', () => {
            const tree = JSON.parse(JSON.stringify({ type: 'condition', columnKey: 'a', operator: 'isNull', value: undefined }));
            expect(evaluateFilterTree(tree, row)).toBe(false);
        });
    });

    describe('fails closed', () => {
        it('on unknown node types', () => {
            expect(evaluateFilterTree({ type: 'bogus' } as unknown as FilterNode, row)).toBe(false);
            expect(evaluateFilterTree(null as unknown as FilterNode, row)).toBe(false);
        });
        it('on unknown group operators', () => {
            const tree = { type: 'group', operator: 'AND', filters: [cond('a', '=', 1), cond('a', '=', 2)] };
            expect(evaluateFilterTree(tree as unknown as FilterNode, row)).toBe(false);
        });
        it('on groups without a filters array', () => {
            expect(evaluateFilterTree({ type: 'group', operator: 'and' } as unknown as FilterNode, row)).toBe(false);
        });
        it('on malformed conditions', () => {
            expect(evaluateFilterTree({ type: 'condition', columnKey: 'a' } as unknown as FilterNode, row)).toBe(false);
            expect(evaluateFilterTree({ type: 'condition', columnKey: {}, operator: '=' } as unknown as FilterNode, row)).toBe(false);
        });
        it('on trees deeper than MAX_FILTER_DEPTH', () => {
            let deep: FilterNode = cond('a', '=', 1);
            for (let i = 0; i < 20000; i++) deep = and(deep);
            expect(() => evaluateFilterTree(deep, row)).not.toThrow();
            expect(evaluateFilterTree(deep, row)).toBe(false);

            let ok: FilterNode = cond('a', '=', 1);
            for (let i = 0; i < MAX_FILTER_DEPTH; i++) ok = and(ok);
            expect(evaluateFilterTree(ok, row)).toBe(true);
        });
    });

    it('reads only own row properties', () => {
        expect(evaluateFilterTree(cond('constructor', 'isNotNull'), {})).toBe(false);
        expect(evaluateFilterTree(cond('toString', 'isNull'), {})).toBe(true);
    });

    describe('neutral nodes', () => {
        it('empty groups match every row', () => {
            expect(evaluateFilterTree(and(), row)).toBe(true);
            expect(evaluateFilterTree(or(), row)).toBe(true);
        });
        it('empty child groups are ignored', () => {
            expect(evaluateFilterTree(and(cond('a', '=', 1), or()), row)).toBe(true);
            expect(evaluateFilterTree(or(cond('a', '=', 2), and()), row)).toBe(false);
        });
        it('conditions without a column yet are ignored', () => {
            expect(evaluateFilterTree(cond('', '=', ''), row)).toBe(true);
            expect(evaluateFilterTree(and(cond('a', '=', 1), cond('', '=', '')), row)).toBe(true);
            expect(evaluateFilterTree(or(cond('a', '=', 2), cond('', '=', '')), row)).toBe(false);
        });
        it('column key 0 is a real column', () => {
            expect(evaluateFilterTree(cond(0, '=', 'z'), { 0: 'z' })).toBe(true);
        });
    });
});
