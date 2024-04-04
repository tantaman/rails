type Schema = {
  table: string;
  fields: {
    [key: string]: unknown;
  };
};

type FromSet = {
  [table: string]: Schema;
};

// Selector type allows for individual field selections with or without an alias, and wildcards
type Selector<T extends keyof F, F extends FromSet> =
  | `${string & keyof F}.${string & keyof F[T]['fields']}`
  | [`${string & keyof F}.${string & keyof F[T]['fields']}`, string]
  | `${string & keyof F}.*`;

type AsString<T> = T extends string ? T : never;

// Adjusted ExtractFieldType for prioritizing wildcard expansion
type ExtractFieldType<F extends FromSet, S> = S extends `${infer T}.*`
  ? T extends keyof F
    ? F[T]['fields']
    : never
  : S extends [`${infer T}.${infer K}`, infer Alias]
    ? {[P in AsString<Alias>]: F[T]['fields'][K]}
    : S extends `${infer T}.${infer K}`
      ? T extends keyof F
        ? K extends keyof F[T]['fields']
          ? {[P in K]: F[T]['fields'][K]}
          : never
        : never
      : never;

// CombineSelections merges selections, applying types for aliases and handling wildcards
type CombineSelections<
  F extends FromSet,
  Selections extends Array<Selector<keyof F, F>>,
  Result = {},
> = Selections extends [infer First, ...infer Rest]
  ? First extends Selector<keyof F, F>
    ? CombineSelections<
        F,
        Rest extends Array<Selector<keyof F, F>> ? Rest : [],
        Result & ExtractFieldType<F, First>
      >
    : never
  : Result;

interface EntityQuery<F extends FromSet, R = {}> {
  select<S extends Array<Selector<keyof F, F>>>(
    ...fields: S
  ): EntityQuery<F, CombineSelections<F, S>>;
}

const exampleFromSet: FromSet = {
  issue: {
    table: 'issueTable',
    fields: {
      foo: 'number',
      boo: 'string',
      title: 'string',
    },
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const query: EntityQuery<typeof exampleFromSet> = {} as any;
const result = query.select(
  ['issue.foo', 'bar'],
  ['issue.boo', 'baz'],
  'issue.title',
);
