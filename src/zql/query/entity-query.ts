import {
  AST,
  Condition,
  Primitive,
  SimpleCondition,
  SimpleOperator,
} from '../ast/ast.js';
import {Context} from '../context/context.js';
import {must} from '../error/asserts.js';
import {Misuse} from '../error/misuse.js';
import {EntitySchema} from '../schema/entity-schema.js';
import {Statement} from './statement.js';

type FieldValue<
  S extends EntitySchema,
  K extends Selectable<S>,
> = S['fields'][K] extends Primitive | undefined ? S['fields'][K] : never;

export type SelectedFields<
  S extends EntitySchema,
  Fields extends Selectable<EntitySchema>[],
> = Pick<
  S['fields'],
  Fields[number] extends keyof S['fields'] ? Fields[number] : never
>;

type AsString<T> = T extends string ? T : never;

export type Selectable<S extends EntitySchema> =
  | AsString<keyof S['fields']>
  | 'id';

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

  select<Fields extends Selectable<S>[]>(...x: Fields) {
    if (this.#ast.select === 'count') {
      throw new Misuse(
        'A query can either return fields or a count, not both.',
      );
    }
    const select = new Set(this.#ast.select);
    for (const more of x) {
      select.add(more);
    }

    return new EntityQuery<S, SelectedFields<S, Fields>[]>(
      this.#context,
      this.#name,
      {
        ...this.#ast,
        select: [...select],
      },
    );
  }

  groupBy<K extends keyof S['fields']>(...x: K[]) {
    return new EntityGroupQuery<S, Return>(this.#context, this.#name, {
      ...this.#ast,
      groupBy: x as string[],
    });
  }

  where<K extends Selectable<S>>(
    field: K,
    op: SimpleOperator,
    value: FieldValue<S, K>,
  ) {
    const leaf: SimpleCondition = {
      field,
      op,
      value: {
        type: 'literal',
        value: value as Primitive,
      },
    };

    let cond: Condition;
    if (!this.#ast.where) {
      cond = leaf;
    } else if (this.#ast.where.op === 'AND') {
      cond = {
        op: 'AND',
        conditions: [...this.#ast.where.conditions, leaf],
      };
    } else {
      cond = {
        op: 'AND',
        conditions: [this.#ast.where, leaf],
      };
    }

    return new EntityQuery<S, Return>(this.#context, this.#name, {
      ...this.#ast,
      where: cond,
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

  count() {
    if (this.#ast.select !== undefined) {
      throw new Misuse(
        'Selection set already set. Will not change to a count query.',
      );
    }
    return new EntityQuery<S, number>(this.#context, this.#name, {
      ...this.#ast,
      select: 'count',
    });
  }

  prepare(): Statement<Return> {
    return new Statement<Return>(this.#context, this.#ast);
  }
}

const astWeakMap = new WeakMap<EntityQuery<EntitySchema, unknown>, AST>();

export function astForTesting(q: EntityQuery<EntitySchema, unknown>): AST {
  return must(astWeakMap.get(q));
}

export class EntityGroupQuery<S extends EntitySchema, Return = []> {
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
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  get _ast() {
    return this.#ast;
  }

  count<K extends keyof S['fields']>(field: K, alias?: string | undefined) {
    return new EntityGroupQuery<S, number>(this.#context, this.#name, {
      ...this.#ast,
      aggregate: [
        ...(this.#ast.aggregate || []),
        {
          field: field as string,
          alias: alias ?? (field as string),
          aggregate: 'count',
        },
      ],
    });
  }

  sum<K extends keyof S['fields']>(field: K, alias?: string | undefined) {
    return new EntityGroupQuery<S, number>(this.#context, this.#name, {
      ...this.#ast,
      aggregate: [
        ...(this.#ast.aggregate || []),
        {
          field: field as string,
          alias: alias ?? (field as string),
          aggregate: 'sum',
        },
      ],
    });
  }

  avg<K extends keyof S['fields']>(field: K, alias?: string | undefined) {
    return new EntityGroupQuery<S, number>(this.#context, this.#name, {
      ...this.#ast,
      aggregate: [
        ...(this.#ast.aggregate || []),
        {
          field: field as string,
          alias: alias ?? (field as string),
          aggregate: 'avg',
        },
      ],
    });
  }

  min<K extends keyof S['fields']>(field: K, alias?: string | undefined) {
    return new EntityGroupQuery<S, number>(this.#context, this.#name, {
      ...this.#ast,
      aggregate: [
        ...(this.#ast.aggregate || []),
        {
          field: field as string,
          alias: alias ?? (field as string),
          aggregate: 'min',
        },
      ],
    });
  }

  max<K extends keyof S['fields']>(field: K, alias?: string | undefined) {
    return new EntityGroupQuery<S, number>(this.#context, this.#name, {
      ...this.#ast,
      aggregate: [
        ...(this.#ast.aggregate || []),
        {
          field: field as string,
          alias: alias ?? (field as string),
          aggregate: 'max',
        },
      ],
    });
  }

  array<K extends keyof S['fields']>(field: K, alias?: string | undefined) {
    return new EntityGroupQuery<S, number>(this.#context, this.#name, {
      ...this.#ast,
      aggregate: [
        ...(this.#ast.aggregate || []),
        {
          field: field as string,
          alias: alias ?? (field as string),
          aggregate: 'array',
        },
      ],
    });
  }

  limit(n: number) {
    if (this.#ast.limit !== undefined) {
      throw new Misuse('Limit already set');
    }

    return new EntityGroupQuery<S, Return>(this.#context, this.#name, {
      ...this.#ast,
      limit: n,
    });
  }

  asc(...x: (keyof S['fields'])[]) {
    if (!x.includes('id')) {
      x.push('id');
    }

    return new EntityGroupQuery<S, Return>(this.#context, this.#name, {
      ...this.#ast,
      orderBy: [x as string[], 'asc'],
    });
  }

  desc(...x: (keyof S['fields'])[]) {
    if (!x.includes('id')) {
      x.push('id');
    }

    return new EntityGroupQuery<S, Return>(this.#context, this.#name, {
      ...this.#ast,
      orderBy: [x as string[], 'desc'],
    });
  }

  prepare(): Statement<Return> {
    return new Statement<Return>(this.#context, this.#ast);
  }
}

/*
aggregate ops can take a key for the reduction to apply to?
Non join result:
[
  {...row},
]

join result:
[
  {
    id,
    left: {...row},
    right: {...row},
  },
]

group-by application would need to know how to extract join
details.
*/
