/* eslint-disable @typescript-eslint/no-explicit-any */

type Schema = {
  [key: string]: unknown;
};

type FromSet = {
  [table: string]: Schema;
};

// type Selector<T extends keyof F, F extends FromSet> =
//   | `${string & keyof F}.${string & keyof F[T]}`
//   | `${string & keyof F}.*`
//   | [`${string & keyof F}.${string & keyof F[T]}`, string];

type Selector<F extends FromSet> =
  | {
      [K in keyof F]:
        | `${string & K}.${string & keyof F[K]}`
        | `${string & K}.*`
        | [`${string & K}.${string & keyof F[K]}`, string];
    }[keyof F]
  | {[K in keyof F]: `${string & K}.${string & keyof F[K]}`}[keyof F];

type SimpleSelector<
  T extends keyof F,
  F extends FromSet,
> = `${string & keyof F}.${string & keyof F[T]}`;

type AsString<T> = T extends string ? T : never;

type ExtractFieldType<F extends FromSet, S extends Selector<F>> = S extends [
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

type CombineSelections<
  F extends FromSet,
  Selections extends Selector<F>[],
> = Selections extends [infer First, ...infer Rest]
  ? First extends Selector<F>
    ? CombineSelections<F, Rest extends Selector<F>[] ? Rest : []> &
        ExtractFieldType<F, First>
    : never
  : unknown;

interface EntityQuery<F extends FromSet, Result = []> {
  select<S extends Selector<F>[]>(
    ...fields: S
  ): EntityQuery<F, CombineSelections<F, S>[]>;

  exec(): Result;

  // joins `other` based on applied select since applied select moves stuff up.
  // join<Other extends EntityQuery<FromSet, unknown>, Alias extends string>(
  //   other: Other,
  //   alias: Alias,
  //   thisField: SimpleSelector<keyof F, F>,
  //   otherField: SimpleSelector<
  //     Other extends EntityQuery<infer OtherFrom, unknown>
  //       ? keyof OtherFrom
  //       : never,
  //     Other extends EntityQuery<infer OtherFrom, unknown> ? OtherFrom : never
  //   >,
  // ): EntityQuery<
  //   F & {
  //     [k in Alias]: Other extends EntityQuery<FromSet, infer OtherReturn>
  //       ? OtherReturn extends Array<infer E>
  //         ? E
  //         : never
  //       : never;
  //   },
  //   Result
  // >;

  join<OtherReturn extends {[key: string]: unknown}, Alias extends string>(
    other: EntityQuery<FromSet, Array<OtherReturn>>,
    alias: Alias,
    thisField: SimpleSelector<keyof F, F>,
    otherField: `${Alias}.${string & keyof OtherReturn}`,
  ): EntityQuery<F & {[K in Alias]: OtherReturn}, Result>;

  // & {[K in Alias]: {fields: OtherReturn}}
}

type Issue = {
  id: string;
  title: string;
  prio: number;
  ownerId: string;
};

type User = {
  id: string;
  name: string;
  email: string;
  title: string;
};

const q: EntityQuery<{issue: Issue}> = {} as any;
q.select(['issue.id', 'issue_id'] as const, 'issue.prio');
q.select('issue.*');
q.select('issue.ownerId');

const q2: EntityQuery<{user: User}> = {} as any;
const q3 = q.join(q2.select('user.*'), 'user', 'issue.ownerId', 'user.id');
q3.select('issue.title', 'user.email');
// q3.select('user.id')
// const q3 = q.join(q2.select('user.name'), 'user', 'issue.ownerId', 'user.id');
// q3.select('');

console.log(q);

// function foo<S extends Schema>(k: keyof S) {
//   return {[k]: null};
// }

// function bar<S extends FromSet>(k: keyof S) {}

// function baz<F extends FromSet, T extends keyof F>(
//   t: keyof F,
//   f: keyof F[T],
// ) {}

// foo<E>('ix');
// bar<F>('d');
// baz<F, 'issue'>('issue', 'id');

/**
 * Two options:
 * - require select to join w/ query
 * - allow path
 *
 * Joining with unjoined query does not require select?
 */
