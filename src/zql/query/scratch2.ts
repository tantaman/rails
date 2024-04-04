type Schema = {
  table: string;
  fields: {
    [key: string]: unknown;
  };
};

type FromSet = {
  [table: string]: Schema;
};

type ToFromSet<S extends Schema> = {
  [Key in S['table']]: S;
};

// type SelectedFields<
//   F extends FromSet,
//   Fields extends [],
// > = ;

type Selector<T extends keyof F, F extends FromSet, Alias extends string> =
  | `${string & keyof F}.${string & keyof F[T]['fields']}`
  | `${string & keyof F}.*`
  | [`${string & keyof F}.${string & keyof F[T]['fields']}`, Alias];

// type ExtractFieldType<
//   F extends FromSet,
//   S extends Selector<keyof F, F>,
// > = S extends `${infer T}.${infer K}`
//   ? T extends keyof F
//     ? K extends keyof F[T]['fields']
//       ? {[P in K]: F[T]['fields'][K]}
//       : never
//     : never
//   : S extends `${infer T}.*`
//     ? T extends keyof F
//       ? F[T]['fields']
//       : never
//     : never;
type AsString<T> = T extends string ? T : never;
type ExtractFieldType<
  F extends FromSet,
  S extends Selector<keyof F, F, Alias>,
  Alias extends string,
> = S extends [`${infer T}.${infer K}`, Alias]
  ? T extends keyof F
    ? K extends keyof F[T]['fields']
      ? {[P in AsString<Alias>]: F[T]['fields'][K]}
      : never
    : never
  : S extends `${infer T}.*`
    ? T extends keyof F
      ? F[T]['fields']
      : never
    : S extends `${infer T}.${infer K}`
      ? T extends keyof F
        ? K extends keyof F[T]['fields']
          ? {[P in K]: F[T]['fields'][K]}
          : never
        : never
      : never;

type CombineSelections<
  F extends FromSet,
  Selections extends Selector<keyof F, F, string>[],
> = Selections extends [infer First, ...infer Rest]
  ? First extends Selector<keyof F, F, infer Alias>
    ? CombineSelections<
        F,
        Rest extends Selector<keyof F, F, Alias>[] ? Rest : []
      > &
        ExtractFieldType<F, First, Alias>
    : never
  : unknown;

interface EntityQuery<F extends FromSet, R = []> {
  // select<T extends keyof F>(field: [keyof F, keyof F[T]['fields']]): void;
  select<T extends keyof F, S extends Selector<T, F, string>[]>(
    ...field: S
  ): EntityQuery<F, CombineSelections<F, S>[]>;
  // we'll un-apply the select if one exists on `other`
  // giving us access to all fields of the joined query.
  // no, it must be post-select so columns can be flattened in case `other` joined many things.
  // join<FromSetOther extends FromSet>(other: EntityQuery<FromSetOther>): void;
  join<FOther extends FromSet, ROther>(
    other: EntityQuery<FOther, ROther>,
  ): void;
}

type E = {
  table: 'issue';
  fields: {
    id: string;
    title: string;
    prio: number;
  };
};

const q: EntityQuery<ToFromSet<E>>;
q.select(['issue.id', 'issue_id'] as const, 'issue.prio');
q.select('issue.*');

// function foo<S extends Schema>(k: keyof S['fields']) {
//   return {[k]: null};
// }

// function bar<S extends FromSet>(k: keyof S) {}

// function baz<F extends FromSet, T extends keyof F>(
//   t: keyof F,
//   f: keyof F[T]['fields'],
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
