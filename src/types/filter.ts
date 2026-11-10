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
    value: any;
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