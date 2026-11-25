export type OperatorType =
    '=' | '!=' | '<' | '<=' | '>=' | '>' |
    'in' | 'notIn' | 'isNull' | 'isNotNull' |
    'empty' | 'notEmpty' |
    'contains' | 'doesNotContain' |
    'startsWith' | 'doesNotStartWith' |
    'endsWith' | 'doesNotEndWith' | 'matches' |
    'between' | 'notBetween' |
    'isTrue' | 'isFalse';

export interface FilterCondition {
    type: 'condition';
    columnKey: string | number;
    operator: OperatorType;
    /** Omitted for value-less operators (isNull, isNotNull, empty, notEmpty, isTrue, isFalse).
     *  between/notBetween → [min, max]; in/notIn → array; matches → pattern string or RegExp. */
    value?: any;
}

export interface FilterGroup {
    type: 'group';
    operator: 'and' | 'or';
    filters: FilterNode[];
}

export interface FilterOptions {
    caseInsensitive?: boolean;
}

export type FilterNode = FilterCondition | FilterGroup;