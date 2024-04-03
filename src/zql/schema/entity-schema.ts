export type Fields = {
  id: string;
} & {
  [key: string]: unknown;
};

export interface EntitySchema<Table extends string> {
  readonly table: Table;
  readonly fields: Fields;
}
