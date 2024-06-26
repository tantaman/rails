import {
  AST,
  Aggregation,
  Condition,
  Primitive,
  SimpleOperator,
} from '../ast/ast.js';
import {Context} from '../context/context.js';
import {must} from '../error/asserts.js';
import {Misuse} from '../error/misuse.js';
import {EntitySchema} from '../schema/entity-schema.js';
import {AggArray, Aggregate, Count, isAggregate} from './agg.js';
import {Statement} from './statement.js';

type FieldValue<
  S extends EntitySchema,
  K extends Selectable<S>,
> = S['fields'][K] extends Primitive | undefined ? S['fields'][K] : never;

type AggregateValue<S extends EntitySchema, K extends Aggregable<S>> =
  K extends Count<string>
    ? number
    : K extends AggArray<string, string>
      ? S['fields'][K['field']][]
      : K extends Exclude<Aggregable<S>, Count<string>>
        ? S['fields'][K['field']]
        : never;

export type SelectedFields<
  S extends EntitySchema,
  Fields extends Selectable<EntitySchema>[],
> = Pick<
  S['fields'],
  Fields[number] extends keyof S['fields'] ? Fields[number] : never
>;

type SelectedAggregates<
  S extends EntitySchema,
  Aggregates extends Aggregable<S>[],
> = {
  [K in Aggregates[number]['alias']]: AggregateValue<
    S,
    Extract<Aggregates[number], {alias: K}>
  >;
};

type AsString<T> = T extends string ? T : never;

export type Selectable<S extends EntitySchema> =
  | AsString<keyof S['fields']>
  | 'id';

type Aggregable<S extends EntitySchema> = Aggregate<
  AsString<keyof S['fields']>,
  string
>;

type ToSelectableOnly<T, S extends EntitySchema> = T extends (infer U)[]
  ? U extends Selectable<S>
    ? U[]
    : never
  : never;

type ToAggregableOnly<T, S extends EntitySchema> = T extends (infer U)[]
  ? U extends Aggregable<S>
    ? U[]
    : never
  : never;

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

type WhereExpression<S extends EntitySchema> =
  | {
      op: 'AND' | 'OR';
      conditions: WhereExpression<S>[];
    }
  | SimpleExpression<S, Selectable<S>>;

type SimpleExpression<S extends EntitySchema, F extends Selectable<S>> = {
  op: SimpleOperator;
  field: F;
  value: {
    type: 'literal';
    value: FieldValue<S, F>;
  };
};

export class EntityQuery<S extends EntitySchema, Return = []> {
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

  select<Fields extends (Selectable<S> | Aggregable<S>)[]>(...x: Fields) {
    const select = new Set(this.#ast.select);
    const aggregate: Aggregation[] = [];
    for (const more of x) {
      if (!isAggregate(more)) {
        select.add(more);
        continue;
      }
      aggregate.push(more);
    }

    return new EntityQuery<
      S,
      (SelectedFields<S, ToSelectableOnly<Fields, S>> &
        SelectedAggregates<S, ToAggregableOnly<Fields, S>>)[]
    >(this.#context, this.#name, {
      ...this.#ast,
      select: [...select],
      aggregate,
    });
  }

  groupBy<K extends Selectable<S>>(...x: K[]) {
    return new EntityQuery<S, Return>(this.#context, this.#name, {
      ...this.#ast,
      groupBy: x as string[],
    });
  }

  where(expr: WhereExpression<S>): EntityQuery<S, Return>;
  where<K extends Selectable<S>>(
    field: K,
    op: SimpleOperator,
    value: FieldValue<S, K>,
  ): EntityQuery<S, Return>;
  where<K extends Selectable<S>>(
    exprOrField: K | WhereExpression<S>,
    op?: SimpleOperator,
    value?: FieldValue<S, K>,
  ): EntityQuery<S, Return> {
    let expr: WhereExpression<S>;
    if (typeof exprOrField === 'string') {
      expr = expression(exprOrField, op!, value!);
    } else {
      expr = exprOrField;
    }

    let cond: WhereExpression<S>;
    const where = this.#ast.where as WhereExpression<S> | undefined;
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

    return new EntityQuery<S, Return>(this.#context, this.#name, {
      ...this.#ast,
      where: cond as Condition,
    });
  }

  limit(n: number) {
    if (this.#ast.limit !== undefined) {
      throw new Misuse('Limit already set');
    }

    return new EntityQuery<S, Return>(this.#context, this.#name, {
      ...this.#ast,
      limit: n,
    });
  }

  asc(...x: Selectable<S>[]) {
    if (!x.includes('id')) {
      x.push('id');
    }

    return new EntityQuery<S, Return>(this.#context, this.#name, {
      ...this.#ast,
      orderBy: [x, 'asc'],
    });
  }

  desc(...x: Selectable<S>[]) {
    if (!x.includes('id')) {
      x.push('id');
    }

    return new EntityQuery<S, Return>(this.#context, this.#name, {
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

export function or<S extends EntitySchema>(
  ...conditions: ArrayOfAtLeastTwo<WhereExpression<S>>
): WhereExpression<S> {
  return flatten('OR', conditions);
}

export function and<S extends EntitySchema>(
  ...conditions: ArrayOfAtLeastTwo<WhereExpression<S>>
): WhereExpression<S> {
  return flatten('AND', conditions);
}

function flatten<S extends EntitySchema>(
  op: 'AND' | 'OR',
  conditions: WhereExpression<S>[],
): WhereExpression<S> {
  const flattened: WhereExpression<S>[] = [];
  for (const c of conditions) {
    if (c.op === op) {
      flattened.push(...c.conditions);
    } else {
      flattened.push(c);
    }
  }

  return {op, conditions: flattened};
}

export function expression<S extends EntitySchema, K extends Selectable<S>>(
  field: K,
  op: SimpleOperator,
  value: FieldValue<S, K>,
): WhereExpression<S> {
  return {
    op,
    field,
    value: {
      type: 'literal',
      value,
    },
  };
}
