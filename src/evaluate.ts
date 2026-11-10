import { OperatorType, FilterNode, FilterOptions } from './types/filter';

function isStringOp(rowValue: any, filterValue: any, op: (a: string, b: string) => boolean, options: FilterOptions): boolean {
    if (typeof rowValue !== 'string' || typeof filterValue !== 'string') return false;
    if (options.caseInsensitive) {
        return op(rowValue.toLowerCase(), filterValue.toLowerCase());
    }
    return op(rowValue, filterValue);
}

function compareEquality(rowValue: any, filterValue: any, operator: OperatorType, options: FilterOptions): boolean {
    // Case-insensitive string comparison
    if (
        options.caseInsensitive &&
        typeof rowValue === 'string' &&
        typeof filterValue === 'string'
    ) {
        if (operator === '=') return rowValue.toLowerCase() === filterValue.toLowerCase();
        if (operator === '!=') return rowValue.toLowerCase() !== filterValue.toLowerCase();
        return false;
    }
    // Default comparison
    if (operator === '=') return rowValue === filterValue;
    if (operator === '!=') return rowValue !== filterValue;
    return false;
}

function compareRelational(rowValue: any, filterValue: any, operator: OperatorType): boolean {
    switch (operator) {
        case '<': return rowValue < filterValue;
        case '<=': return rowValue <= filterValue;
        case '>=': return rowValue >= filterValue;
        case '>': return rowValue > filterValue;
        default: return false;
    }
}

function compareInclusion(rowValue: any, filterValue: any, operator: OperatorType): boolean {
    if (!Array.isArray(filterValue)) return false;
    if (operator === 'in') return filterValue.includes(rowValue);
    if (operator === 'notIn') return !filterValue.includes(rowValue);
    return false;
}

function compareNull(rowValue: any, operator: OperatorType): boolean {
    if (operator === 'isNull') return rowValue === null || rowValue === undefined;
    if (operator === 'isNotNull') return rowValue !== null && rowValue !== undefined;
    return false;
}

function compareEmpty(rowValue: any, operator: OperatorType): boolean {
    const isEmpty = rowValue === '' || rowValue === null || rowValue === undefined || (Array.isArray(rowValue) && rowValue.length === 0);
    if (operator === 'empty') return isEmpty;
    if (operator === 'notEmpty') return !isEmpty;
    return false;
}

function compareString(rowValue: any, filterValue: any, operator: OperatorType, options: FilterOptions): boolean {
    switch (operator) {
        case 'contains': return isStringOp(rowValue, filterValue, (a, b) => a.includes(b), options);
        case 'doesNotContain': return isStringOp(rowValue, filterValue, (a, b) => !a.includes(b), options);
        case 'startsWith': return isStringOp(rowValue, filterValue, (a, b) => a.startsWith(b), options);
        case 'doesNotStartWith': return isStringOp(rowValue, filterValue, (a, b) => !a.startsWith(b), options);
        case 'endsWith': return isStringOp(rowValue, filterValue, (a, b) => a.endsWith(b), options);
        case 'doesNotEndWith': return isStringOp(rowValue, filterValue, (a, b) => !a.endsWith(b), options);
        case 'matches': return typeof rowValue === 'string' && filterValue instanceof RegExp && filterValue.test(rowValue);
        default: return false;
    }
}

function compareBetween(rowValue: any, filterValue: any, operator: OperatorType): boolean {
    if (!Array.isArray(filterValue) || filterValue.length !== 2) return false;
    if (operator === 'between') return rowValue >= filterValue[0] && rowValue <= filterValue[1];
    if (operator === 'notBetween') return rowValue < filterValue[0] || rowValue > filterValue[1];
    return false;
}

function compareBoolean(rowValue: any, operator: OperatorType): boolean {
    if (operator === 'isTrue') return rowValue === true;
    if (operator === 'isFalse') return rowValue === false;
    return false;
}

export function applyOperator(rowValue: any, operator: OperatorType, filterValue: any, options: FilterOptions): boolean {
    if (operator === '=' || operator === '!=') return compareEquality(rowValue, filterValue, operator, options);
    if (['<', '<=', '>=', '>'].includes(operator)) return compareRelational(rowValue, filterValue, operator);
    if (operator === 'in' || operator === 'notIn') return compareInclusion(rowValue, filterValue, operator);
    if (operator === 'isNull' || operator === 'isNotNull') return compareNull(rowValue, operator);
    if (operator === 'empty' || operator === 'notEmpty') return compareEmpty(rowValue, operator);
    if (
        [
            'contains', 'doesNotContain', 'startsWith', 'doesNotStartWith',
            'endsWith', 'doesNotEndWith', 'matches'
        ].includes(operator)
    ) return compareString(rowValue, filterValue, operator, options);
    if (operator === 'between' || operator === 'notBetween') return compareBetween(rowValue, filterValue, operator);
    if (operator === 'isTrue' || operator === 'isFalse') return compareBoolean(rowValue, operator);
    return false;
}

export function evaluateFilterTree(
    node: FilterNode,
    row: Record<string, any>,
    options: FilterOptions = { caseInsensitive: false }
): boolean {
    // If node.type is missing, assume it's a condition node
    const nodeType = (node as any).type ?? 'condition';

    if (nodeType === 'condition' && 'columnKey' in node && 'operator' in node && 'value' in node) {
        const cell = row[node.columnKey];
        const cellValue = cell && typeof cell === 'object' && 'value' in cell ? cell.value : cell;
        return applyOperator(cellValue, node.operator, node.value, options);
    } else if (nodeType === 'group' && 'operator' in node && 'filters' in node) {
        if (node.operator === 'and') {
            return node.filters.every(child => evaluateFilterTree(child, row, options));
        } else {
            return node.filters.some(child => evaluateFilterTree(child, row, options));
        }
    }
    return true;
}
