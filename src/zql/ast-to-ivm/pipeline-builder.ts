import {Entity} from '../../generate.js';
import {
  AST,
  Aggregation,
  Condition,
  Ordering,
  SimpleCondition,
  SimpleOperator,
} from '../ast/ast.js';
import {assert, must} from '../error/asserts.js';
import {DifferenceStream} from '../ivm/graph/difference-stream.js';

export const orderingProp = Symbol();

export function buildPipeline(
  sourceStreamProvider: (sourceName: string) => DifferenceStream<Entity>,
  ast: AST,
) {
  // filters first
  // maps second
  // order is a param to materialization
  // as well as limit? How does limit work in materialite again?
  let stream = sourceStreamProvider(
    must(ast.table, 'Table not specified in the AST'),
  );

  if (ast.where) {
    stream = applyWhere(stream, ast.where);
  }

  let ret: DifferenceStream<unknown> = stream;
  if (ast.groupBy) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ret = applyGroupBy(ret as DifferenceStream<Entity>, ast.groupBy);
  }

  assert(ast.select, 'No select clause');
  if (ast.select === 'count') {
    ret = ret.linearCount();
  } else {
    ret = applySelect(ret as DifferenceStream<Entity>, ast.select, ast.orderBy);
  }

  // Note: the stream is technically attached at this point.
  // We could detach it until the user actually runs (or subscribes to) the statement as a tiny optimization.
  return ret;
}

export function applySelect(
  stream: DifferenceStream<Entity>,
  select: string[],
  orderBy: Ordering | undefined,
) {
  return stream.map(x => {
    let ret: Partial<Record<string, unknown>>;
    if (select.length === 0) {
      ret = {...x};
    } else {
      ret = {};
      for (const field of select) {
        ret[field] = (x as Record<string, unknown>)[field];
      }
    }

    const orderingValues: unknown[] = [];
    if (orderBy !== undefined) {
      for (const field of orderBy[0]) {
        orderingValues.push((x as Record<string, unknown>)[field]);
      }
    }

    Object.defineProperty(ret, orderingProp, {
      enumerable: false,
      writable: false,
      configurable: false,
      value: orderingValues,
    });

    return ret;
  });
}

function applyWhere(stream: DifferenceStream<Entity>, where: Condition) {
  let ret = stream;
  // We'll handle `OR` and parentheticals like so:
  // OR: We'll create a new stream for the LHS and RHS of the OR then merge together.
  // Parentheticals: We'll create a new stream for the LHS and RHS of the operator involved in combining the parenthetical then merge together.
  //
  // Example:
  // (a = 1 AND b = 2) OR (c = 3 AND d = 4)
  // Becomes
  //       s
  //      / \
  //    a=1 c=3
  //    /     \
  //    b=2   d=4
  //     \    /
  //       OR
  //        |
  //
  // So `ORs` cause a fork (two branches that need to be evaluated) and then that fork is combined.
  if (where.op === 'AND') {
    for (const condition of where.conditions) {
      ret = applyWhere(ret, condition);
    }
  } else {
    ret = applySimpleCondition(ret, where);
  }

  return ret;
}

function applySimpleCondition(
  stream: DifferenceStream<Entity>,
  condition: SimpleCondition,
) {
  const operator = getOperator(condition.op);
  return stream.filter(x =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    operator((x as any)[condition.field], condition.value.value),
  );
}

function applyGroupBy<T extends Entity>(
  stream: DifferenceStream<T>,
  columns: string[],
  aggregations: Aggregation[] = [],
) {
  const keyFunction = makeKeyFunction(columns);
  return stream.reduce(
    keyFunction,
    value => value.id as string,
    values => {
      const ret: Entity & Record<string, unknown> = {
        id: keyFunction(values[Symbol.iterator]().next().value),
      };

      for (const aggregation of aggregations) {
        switch (aggregation.aggregate) {
          case 'count': {
            let count = 0;
            for (const _ of values) {
              count++;
            }
            ret[aggregation.alias] = count;
            break;
          }
          case 'sum': {
            let sum = 0;
            for (const value of values) {
              sum += value[aggregation.field as keyof T] as number;
            }
            ret[aggregation.alias] = sum;
            break;
          }
          case 'avg': {
            let sum = 0;
            let count = 0;
            for (const value of values) {
              sum += value[aggregation.field as keyof T] as number;
              count++;
            }
            ret[aggregation.alias] = sum / count;
            break;
          }
          case 'min': {
            let min = Infinity;
            for (const value of values) {
              min = Math.min(
                min,
                value[aggregation.field as keyof T] as number,
              );
            }
            ret[aggregation.alias] = min;
            break;
          }
          case 'max': {
            let max = -Infinity;
            for (const value of values) {
              max = Math.max(
                max,
                value[aggregation.field as keyof T] as number,
              );
            }
            ret[aggregation.alias] = max;
            break;
          }
          case 'array': {
            ret[aggregation.alias] = Array.from(values).map(
              x => x[aggregation.field as keyof T],
            );
            break;
          }
          default:
            throw new Error(`Unknown aggregation ${aggregation.aggregate}`);
        }
      }
      return ret;
    },
  );
}

function makeKeyFunction(columns: string[]) {
  return (x: Record<string, unknown>) => {
    const ret: unknown[] = [];
    for (const column of columns) {
      ret.push(x[column]);
    }
    // Would it be better to come up with someh hash function
    // which can handle complex types?
    return JSON.stringify(ret);
  };
}

// We're well-typed in the query builder so once we're down here
// we can assume that the operator is valid.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getOperator(op: SimpleOperator): (l: any, r: any) => boolean {
  switch (op) {
    case '=':
      return (l, r) => l === r;
    case '<':
      return (l, r) => l < r;
    case '>':
      return (l, r) => l > r;
    case '>=':
      return (l, r) => l >= r;
    case '<=':
      return (l, r) => l <= r;
    case 'IN':
      return (l, r) => r.includes(l);
    case 'LIKE':
      return (l, r) => l.includes(r);
    case 'ILIKE':
      return (l, r) => l.toLowerCase().includes(r.toLocaleLowerCase());
    default:
      throw new Error(`Operator ${op} not supported`);
  }
}
