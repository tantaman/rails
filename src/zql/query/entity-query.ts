import {AST, Aggregation, Condition, SimpleOperator} from '../ast/ast.js';
import {Context} from '../context/context.js';
import {must} from '../error/asserts.js';
import {Misuse} from '../error/misuse.js';
import {EntitySchema} from '../schema/entity-schema.js';
import {AggArray, Aggregate, isAggregate} from './agg.js';
import {Statement} from './statement.js';

type FromSet = {
  [tableOrAlias: string]: EntitySchema;
};

type AsString<T> = T extends string ? T : never;
type NestedKeys<T> = {
  [K in keyof T]: keyof T[K];
}[keyof T];

type SimpleSelector<F extends FromSet> =
  | 'id'
  | {
      [K in keyof F]: Exclude<string & keyof F[K], NestedKeys<Omit<F, K>>>;
    }[keyof F]
  | {
      [K in keyof F]: `${string & K}.${string & keyof F[K]}`;
    }[keyof F];

type Selector<F extends FromSet> =
  | {
      [K in keyof F]:
        | `${string & K}.${string & keyof F[K]}`
        | `${string & K}.*`
        | [`${string & K}.${string & keyof F[K]}`, string]
        | Exclude<string & keyof F[K], NestedKeys<Omit<F, K>>>;
    }[keyof F]
  | SimpleSelector<F>;

type ExtractAggregatePiece<From extends FromSet, K extends Aggregator<From>> =
  K extends AggArray<infer S, infer Alias>
    ? {
        [K in Alias]: ExtractFieldValue<
          From,
          S extends SimpleSelector<From> ? S : never
        >;
      }[]
    : K extends Aggregate<string, infer Alias>
      ? {[K in Alias]: number}
      : never;

type ExtractFieldPiece<F extends FromSet, S extends Selector<F>> = S extends [
  `${infer T}.${infer K}`,
  infer Alias,
]
  ? T extends keyof F
    ? K extends keyof F[T]
      ? {[P in AsString<Alias>]: F[T][K]}
      : never
    : never
  : S extends `${infer T}.*`
    ? T extends keyof F
      ? F[T]
      : never
    : S extends `${infer T}.${infer K}`
      ? T extends keyof F
        ? K extends keyof F[T]
          ? {[P in K]: F[T][K]}
          : never
        : never
      : never;

type ExtractNestedTypeByName<T, S extends string> = {
  [K in keyof T]: S extends keyof T[K] ? T[K][S] : never;
}[keyof T];

type ExtractFieldValue<
  F extends FromSet,
  S extends SimpleSelector<F>,
> = S extends `${infer T}.${infer K}` ? F[T][K] : ExtractNestedTypeByName<F, S>;

type CombineSelections<
  F extends FromSet,
  Selections extends (Selector<F> | Aggregator<F>)[],
> = Selections extends [infer First, ...infer Rest]
  ? First extends Selector<F>
    ? CombineSelections<
        F,
        Rest extends (Selector<F> | Aggregator<F>)[] ? Rest : []
      > &
        ExtractFieldPiece<F, First>
    : First extends Aggregator<F>
      ? CombineSelections<
          F,
          Rest extends (Selector<F> | Aggregator<F>)[] ? Rest : []
        > &
          ExtractAggregatePiece<F, First>
      : never
  : unknown;

type Aggregator<From extends FromSet> = Aggregate<SimpleSelector<From>, string>;

// type ToSelectorOnly<T, From extends FromSet> = T extends (infer U)[]
//   ? U extends Selector<From>
//     ? U[]
//     : never
//   : never;

// type ToAggregatorOnly<T, From extends FromSet> = T extends (infer U)[]
//   ? U extends Aggregator<From>
//     ? U[]
//     : never
//   : never;

/**
 * Have you ever noticed that when you hover over Types in TypeScript, it shows
 * Pick<Omit<T, K>, K>? Rather than the final object structure after picking and omitting?
 * Or any time you use a type alias.
 *
 * MakeHumanReadable collapses the type aliases into their final form.
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export type MakeHumanReadable<T> = {} & {
  readonly [P in keyof T]: T[P] extends string ? T[P] : MakeHumanReadable<T[P]>;
};

let aliasCount = 0;

export type WhereCondition<From extends FromSet> =
  | {
      op: 'AND' | 'OR';
      conditions: WhereCondition<From>[];
    }
  | SimpleCondition<From>;

type SimpleCondition<From extends FromSet> = {
  op: SimpleOperator;
  field: Selector<From>;
  value: {
    type: 'literal';
    value: ExtractFieldValue<From, SimpleSelector<From>>;
  };
};

export class EntityQuery<From extends FromSet, Return = []> {
  readonly #ast: AST;
  readonly #name: string;
  readonly #context: Context;

  constructor(context: Context, tableName: string, ast?: AST) {
    this.#ast = ast ?? {
      table: tableName,
      alias: aliasCount++,
      orderBy: [['id'], 'asc'],
    };
    this.#name = tableName;
    this.#context = context;

    // TODO(arv): Guard this with TESTING once we have the infrastructure.
    astWeakMap.set(this, this.#ast);
  }

  select<Fields extends (Selector<From> | Aggregator<From>)[]>(
    ...x: Fields
  ): EntityQuery<From, CombineSelections<From, Fields>[]> {
    const select = new Set(this.#ast.select);
    const aggregate: Aggregation[] = [];
    for (const more of x) {
      if (!isAggregate(more)) {
        if (Array.isArray(more)) {
          select.add(more);
        } else {
          select.add([more, more]);
        }

        continue;
      }
      aggregate.push(more);
    }

    return new EntityQuery<From, CombineSelections<From, Fields>[]>(
      this.#context,
      this.#name,
      {
        ...this.#ast,
        select: [...select],
        aggregate,
      },
    );
  }

  groupBy<Fields extends SimpleSelector<From>[]>(...x: Fields) {
    return new EntityQuery<From, Return>(this.#context, this.#name, {
      ...this.#ast,
      groupBy: x as string[],
    });
  }

  where(expr: WhereCondition<From>): EntityQuery<From, Return>;
  where<K extends SimpleSelector<From>>(
    field: K,
    op: SimpleOperator,
    value: ExtractFieldValue<From, K>,
  ): EntityQuery<From, Return>;
  where<K extends SimpleSelector<From>>(
    exprOrField: K | WhereCondition<From>,
    op?: SimpleOperator,
    value?: ExtractFieldValue<From, K>,
  ): EntityQuery<From, Return> {
    let expr: WhereCondition<From>;
    if (typeof exprOrField === 'string') {
      expr = expression(exprOrField, op!, value!);
    } else {
      expr = exprOrField;
    }

    let cond: WhereCondition<From>;
    const where = this.#ast.where as WhereCondition<From> | undefined;
    if (!where) {
      cond = expr;
    } else if (where.op === 'AND') {
      const {conditions} = where;
      cond = flatten('AND', [...conditions, expr]);
    } else {
      cond = {
        op: 'AND',
        conditions: [where, expr],
      };
    }

    return new EntityQuery<From, Return>(this.#context, this.#name, {
      ...this.#ast,
      where: cond as Condition,
    });
  }

  limit(n: number) {
    if (this.#ast.limit !== undefined) {
      throw new Misuse('Limit already set');
    }

    return new EntityQuery<From, Return>(this.#context, this.#name, {
      ...this.#ast,
      limit: n,
    });
  }

  asc(...x: SimpleSelector<From>[]) {
    if (!x.includes('id')) {
      x.push('id');
    }

    return new EntityQuery<From, Return>(this.#context, this.#name, {
      ...this.#ast,
      orderBy: [x, 'asc'],
    });
  }

  desc(...x: SimpleSelector<From>[]) {
    if (!x.includes('id')) {
      x.push('id');
    }

    return new EntityQuery<From, Return>(this.#context, this.#name, {
      ...this.#ast,
      orderBy: [x, 'desc'],
    });
  }

  prepare(): Statement<Return> {
    return new Statement<Return>(this.#context, this.#ast);
  }
}

const astWeakMap = new WeakMap<WeakKey, AST>();

export function astForTesting(q: WeakKey): AST {
  return must(astWeakMap.get(q));
}

type ArrayOfAtLeastTwo<T> = [T, T, ...T[]];

export function or<F extends FromSet>(
  ...conditions: ArrayOfAtLeastTwo<WhereCondition<F>>
): WhereCondition<F> {
  return flatten('OR', conditions);
}

export function and<F extends FromSet>(
  ...conditions: ArrayOfAtLeastTwo<WhereCondition<F>>
): WhereCondition<F> {
  return flatten('AND', conditions);
}

function flatten<F extends FromSet>(
  op: 'AND' | 'OR',
  conditions: WhereCondition<F>[],
): WhereCondition<F> {
  const flattened: WhereCondition<F>[] = [];
  for (const c of conditions) {
    if (c.op === op) {
      flattened.push(...c.conditions);
    } else {
      flattened.push(c);
    }
  }

  return {op, conditions: flattened};
}

export function expression<F extends FromSet, K extends SimpleSelector<F>>(
  field: K,
  op: SimpleOperator,
  value: ExtractFieldValue<F, K>,
): WhereCondition<F> {
  return {
    op,
    field,
    value: {
      type: 'literal',
      value,
    },
  };
}

export function not<From extends FromSet>(
  expr: WhereCondition<From>,
): WhereCondition<From> {
  switch (expr.op) {
    case 'AND':
      return {
        op: 'OR',
        conditions: expr.conditions.map(not),
      };
    case 'OR':
      return {
        op: 'AND',
        conditions: expr.conditions.map(not),
      };
    default:
      return {
        op: negateOperator(expr.op),
        field: expr.field,
        value: expr.value,
      };
  }
}

function negateOperator(op: SimpleOperator): SimpleOperator {
  switch (op) {
    case '=':
      return '!=';
    case '!=':
      return '=';
    case '<':
      return '>=';
    case '>':
      return '<=';
    case '>=':
      return '<';
    case '<=':
      return '>';
    case 'IN':
      return 'NOT IN';
    case 'NOT IN':
      return 'IN';
    case 'LIKE':
      return 'NOT LIKE';
    case 'NOT LIKE':
      return 'LIKE';
    case 'ILIKE':
      return 'NOT ILIKE';
    case 'NOT ILIKE':
      return 'ILIKE';
  }
}

const q: EntityQuery<{
  user: {
    id: string;
    name: string;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}> = {} as any;

import * as agg from './agg.js';
const f = q
  .select('user.name', 'user.id', agg.count())
  .where('name', '!=', '')
  .prepare()
  .exec();
// const g = q.select(agg.avg('name')).prepare().exec();
