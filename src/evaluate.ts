import type { OperatorType, FilterNode, FilterOptions } from './types/filter.js';

/** Filter trees nested deeper than this are treated as invalid (no row matches). */
export const MAX_FILTER_DEPTH = 100;
/** `matches` patterns longer than this are rejected (no row matches). */
export const MAX_PATTERN_LENGTH = 1000;

const PATTERN_CACHE_LIMIT = 200;
const patternCache = new Map<string, RegExp | null>();

function isBlank(value: unknown): boolean {
    return value === null || value === undefined || value === '';
}

function hasOwn(obj: object, key: PropertyKey): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function foldCase(value: unknown, options: FilterOptions): unknown {
    return options.caseInsensitive && typeof value === 'string' ? value.toLowerCase() : value;
}

function toNumber(value: unknown): number | undefined {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
}

function toTime(value: unknown): number | undefined {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.getTime();
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string' && value.trim() !== '') {
        const t = Date.parse(value);
        return Number.isNaN(t) ? undefined : t;
    }
    return undefined;
}

/**
 * Brings two values to a common comparable type, or returns undefined if they are not comparable.
 * - blank (null / undefined / '') on either side → not comparable
 * - a Date on either side → both compared as timestamps (Date, ISO string or epoch ms)
 * - both numeric (numbers or numeric strings) → numbers
 * - both strings → strings (lower-cased when caseInsensitive)
 */
function toComparablePair(a: unknown, b: unknown, options: FilterOptions): [number, number] | [string, string] | undefined {
    if (isBlank(a) || isBlank(b)) return undefined;
    if (a instanceof Date || b instanceof Date) {
        const ta = toTime(a);
        const tb = toTime(b);
        return ta === undefined || tb === undefined ? undefined : [ta, tb];
    }
    const na = toNumber(a);
    const nb = toNumber(b);
    if (na !== undefined && nb !== undefined) return [na, nb];
    if (typeof a === 'string' && typeof b === 'string') {
        return [foldCase(a, options) as string, foldCase(b, options) as string];
    }
    return undefined;
}

/** -1 / 0 / 1, or undefined when the values are not comparable. */
function compareValues(a: unknown, b: unknown, options: FilterOptions): number | undefined {
    const pair = toComparablePair(a, b, options);
    if (!pair) return undefined;
    const [x, y] = pair;
    if (x < y) return -1;
    if (x > y) return 1;
    return 0;
}

function isStringOp(rowValue: unknown, filterValue: unknown, op: (a: string, b: string) => boolean, options: FilterOptions): boolean {
    if (typeof rowValue !== 'string' || typeof filterValue !== 'string') return false;
    return op(foldCase(rowValue, options) as string, foldCase(filterValue, options) as string);
}

function compareEquality(rowValue: unknown, filterValue: unknown, operator: OperatorType, options: FilterOptions): boolean {
    const equal = foldCase(rowValue, options) === foldCase(filterValue, options);
    if (operator === '=') return equal;
    if (operator === '!=') return !equal;
    return false;
}

function compareRelational(rowValue: unknown, filterValue: unknown, operator: OperatorType, options: FilterOptions): boolean {
    const cmp = compareValues(rowValue, filterValue, options);
    if (cmp === undefined) return false;
    switch (operator) {
        case '<': return cmp < 0;
        case '<=': return cmp <= 0;
        case '>=': return cmp >= 0;
        case '>': return cmp > 0;
        default: return false;
    }
}

function compareInclusion(rowValue: unknown, filterValue: unknown, operator: OperatorType, options: FilterOptions): boolean {
    if (!Array.isArray(filterValue)) return false;
    const needle = foldCase(rowValue, options);
    const included = filterValue.some(item => foldCase(item, options) === needle);
    if (operator === 'in') return included;
    if (operator === 'notIn') return !included;
    return false;
}

function compareNull(rowValue: unknown, operator: OperatorType): boolean {
    if (operator === 'isNull') return rowValue === null || rowValue === undefined;
    if (operator === 'isNotNull') return rowValue !== null && rowValue !== undefined;
    return false;
}

function compareEmpty(rowValue: unknown, operator: OperatorType): boolean {
    const isEmpty = isBlank(rowValue) || (Array.isArray(rowValue) && rowValue.length === 0);
    if (operator === 'empty') return isEmpty;
    if (operator === 'notEmpty') return !isEmpty;
    return false;
}

function getPattern(source: string, caseInsensitive: boolean): RegExp | null {
    if (source.length > MAX_PATTERN_LENGTH) return null;
    const key = (caseInsensitive ? 'i:' : 's:') + source;
    const cached = patternCache.get(key);
    if (cached !== undefined) return cached;
    let regex: RegExp | null;
    try {
        regex = new RegExp(source, caseInsensitive ? 'i' : '');
    } catch {
        regex = null; // invalid pattern → never matches
    }
    if (patternCache.size >= PATTERN_CACHE_LIMIT) patternCache.clear();
    patternCache.set(key, regex);
    return regex;
}

function compareMatches(rowValue: unknown, filterValue: unknown, options: FilterOptions): boolean {
    if (typeof rowValue !== 'string') return false;
    if (filterValue instanceof RegExp) {
        filterValue.lastIndex = 0; // `g`/`y` regexes are stateful
        return filterValue.test(rowValue);
    }
    if (typeof filterValue !== 'string' || filterValue === '') return false;
    const regex = getPattern(filterValue, !!options.caseInsensitive);
    return regex !== null && regex.test(rowValue);
}

function compareString(rowValue: unknown, filterValue: unknown, operator: OperatorType, options: FilterOptions): boolean {
    switch (operator) {
        case 'contains': return isStringOp(rowValue, filterValue, (a, b) => a.includes(b), options);
        case 'doesNotContain': return isStringOp(rowValue, filterValue, (a, b) => !a.includes(b), options);
        case 'startsWith': return isStringOp(rowValue, filterValue, (a, b) => a.startsWith(b), options);
        case 'doesNotStartWith': return isStringOp(rowValue, filterValue, (a, b) => !a.startsWith(b), options);
        case 'endsWith': return isStringOp(rowValue, filterValue, (a, b) => a.endsWith(b), options);
        case 'doesNotEndWith': return isStringOp(rowValue, filterValue, (a, b) => !a.endsWith(b), options);
        case 'matches': return compareMatches(rowValue, filterValue, options);
        default: return false;
    }
}

function compareBetween(rowValue: unknown, filterValue: unknown, operator: OperatorType, options: FilterOptions): boolean {
    if (!Array.isArray(filterValue) || filterValue.length !== 2) return false;
    const lower = compareValues(rowValue, filterValue[0], options);
    const upper = compareValues(rowValue, filterValue[1], options);
    if (lower === undefined || upper === undefined) return false;
    if (operator === 'between') return lower >= 0 && upper <= 0;
    if (operator === 'notBetween') return lower < 0 || upper > 0;
    return false;
}

function compareBoolean(rowValue: unknown, operator: OperatorType): boolean {
    if (operator === 'isTrue') return rowValue === true;
    if (operator === 'isFalse') return rowValue === false;
    return false;
}

const RELATIONAL_OPERATORS: readonly string[] = ['<', '<=', '>=', '>'];
const STRING_OPERATORS: readonly string[] = [
    'contains', 'doesNotContain', 'startsWith', 'doesNotStartWith',
    'endsWith', 'doesNotEndWith', 'matches'
];

/**
 * Applies one operator to a cell value. Unknown operators never match.
 * Relational and range operators never match blank cells or values of incomparable types.
 */
export function applyOperator(rowValue: any, operator: OperatorType, filterValue: any, options: FilterOptions = {}): boolean {
    if (operator === '=' || operator === '!=') return compareEquality(rowValue, filterValue, operator, options);
    if (RELATIONAL_OPERATORS.includes(operator)) return compareRelational(rowValue, filterValue, operator, options);
    if (operator === 'in' || operator === 'notIn') return compareInclusion(rowValue, filterValue, operator, options);
    if (operator === 'isNull' || operator === 'isNotNull') return compareNull(rowValue, operator);
    if (operator === 'empty' || operator === 'notEmpty') return compareEmpty(rowValue, operator);
    if (STRING_OPERATORS.includes(operator)) return compareString(rowValue, filterValue, operator, options);
    if (operator === 'between' || operator === 'notBetween') return compareBetween(rowValue, filterValue, operator, options);
    if (operator === 'isTrue' || operator === 'isFalse') return compareBoolean(rowValue, operator);
    return false;
}

/** Result of one node: true/false, or null for "neutral" (empty group, condition without a column yet). */
type NodeResult = boolean | null;

function evaluateNode(node: unknown, row: Record<string, any>, options: FilterOptions, depth: number): NodeResult {
    if (depth > MAX_FILTER_DEPTH || node === null || typeof node !== 'object') return false;
    const n = node as Record<string, any>;
    // Nodes without `type` are accepted: groups are recognised by their `filters` array.
    const nodeType = n.type ?? (Array.isArray(n.filters) ? 'group' : 'condition');

    if (nodeType === 'condition') {
        const { columnKey, operator } = n;
        if (columnKey === '' || columnKey === null || columnKey === undefined) return null; // not configured yet
        if ((typeof columnKey !== 'string' && typeof columnKey !== 'number') || typeof operator !== 'string') return false;
        const cell = row !== null && typeof row === 'object' && hasOwn(row, columnKey) ? row[columnKey] : undefined;
        const cellValue = cell !== null && typeof cell === 'object' && 'value' in cell ? cell.value : cell;
        return applyOperator(cellValue, operator as OperatorType, n.value, options);
    }

    if (nodeType === 'group') {
        if (!Array.isArray(n.filters) || (n.operator !== 'and' && n.operator !== 'or')) return false;
        let sawResult = false;
        for (const child of n.filters) {
            const result = evaluateNode(child, row, options, depth + 1);
            if (result === null) continue; // neutral children are ignored
            sawResult = true;
            if (n.operator === 'and' && !result) return false;
            if (n.operator === 'or' && result) return true;
        }
        if (!sawResult) return null;
        return n.operator === 'and';
    }

    return false;
}

/**
 * Evaluates a filter tree against one row.
 * - Groups: `and` / `or` (exact, lower-case); other operators never match.
 * - Empty groups and conditions without a `columnKey` are neutral: they are skipped, and a tree
 *   consisting only of neutral nodes matches every row.
 * - Malformed nodes, unknown node types/operators and trees deeper than MAX_FILTER_DEPTH never match.
 * - Cells shaped like `{ value: x }` are unwrapped to `x`. Only own properties of the row are read.
 */
export function evaluateFilterTree(
    node: FilterNode,
    row: Record<string, any>,
    options: FilterOptions = { caseInsensitive: false }
): boolean {
    return evaluateNode(node, row, options, 0) ?? true;
}
