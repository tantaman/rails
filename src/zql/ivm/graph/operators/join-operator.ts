import {Primitive} from '../../../ast/ast.js';
import {flatMapIter} from '../../../util/iterables.js';
import {Entry, Multiset} from '../../multiset.js';
import {JoinResult, StrOrNum, Version} from '../../types.js';
import {DifferenceStream} from '../difference-stream.js';
import {BinaryOperator} from './binary-operator.js';
import {DifferenceIndex} from './difference-index.js';

export type JoinArgs<
  Key extends Primitive,
  AValue extends object,
  BValue extends object,
  AAlias extends string | undefined,
  BAlias extends string | undefined,
> = {
  a: DifferenceStream<AValue>;
  aAs: AAlias | undefined;
  getAJoinKey: (value: AValue) => Key;
  getAPrimaryKey: (value: AValue) => StrOrNum;
  b: DifferenceStream<BValue>;
  bAs: BAlias | undefined;
  getBJoinKey: (value: BValue) => Key;
  getBPrimaryKey: (value: BValue) => StrOrNum;
  output: DifferenceStream<JoinResult<AValue, BValue, AAlias, BAlias>>;
};

/**
 * Joins two streams.
 *
 * Inputs:
 * - Stream A of changes
 * - Stream B of changes
 * - A function to extract the key to join on from A
 * - A function to extract the key to join on from B
 * - A function to compare the two keys
 *
 * The output is a stream of joined values of the form:
 *
 * ```ts
 * {
 *   table_name_1_or_alias: row_from_t1,
 *   table_name_2_or_alias: row_from_t2,
 * }[]
 * ```
 *
 * From which the `select` operator can extract the desired fields.
 */
export class InnerJoinOperator<
  K extends Primitive,
  AValue extends object,
  BValue extends object,
  AAlias extends string | undefined,
  BAlias extends string | undefined,
> extends BinaryOperator<
  AValue,
  BValue,
  // If AValue or BValue are join results
  // then they should be lifted and need no aliasing
  // since they're already aliased
  JoinResult<AValue, BValue, AAlias, BAlias>
> {
  readonly #inputAPending: DifferenceIndex<K, AValue>[] = [];
  readonly #inputBPending: DifferenceIndex<K, BValue>[] = [];

  constructor({
    a,
    aAs,
    getAJoinKey,
    getAPrimaryKey,
    b,
    bAs,
    getBJoinKey,
    getBPrimaryKey,
    output,
  }: JoinArgs<K, AValue, BValue, AAlias, BAlias>) {
    const indexA = new DifferenceIndex<K, AValue>(getAPrimaryKey);
    const indexB = new DifferenceIndex<K, BValue>(getBPrimaryKey);

    const inner = (
      _version: Version,
      inputA: Multiset<AValue> | undefined,
      inputB: Multiset<BValue> | undefined,
    ) => {
      const aKeysForCompaction: K[] = [];
      const bKeysForCompaction: K[] = [];
      for (const entry of inputA || []) {
        const deltaA = new DifferenceIndex<K, AValue>(getAPrimaryKey);
        const aKey = getAJoinKey(entry[0]);
        deltaA.add(aKey, entry);
        this.#inputAPending.push(deltaA);
        aKeysForCompaction.push(aKey);
      }

      for (const entry of inputB || []) {
        const deltaB = new DifferenceIndex<K, BValue>(getBPrimaryKey);
        const bKey = getBJoinKey(entry[0]);
        deltaB.add(bKey, entry);
        this.#inputBPending.push(deltaB);
        bKeysForCompaction.push(bKey);
      }

      // TODO: profile join and explore alternate join strategies if needed
      const results: Entry<JoinResult<AValue, BValue, AAlias, BAlias>>[][] = [];
      while (this.#inputAPending.length > 0 || this.#inputBPending.length > 0) {
        const result: Entry<JoinResult<AValue, BValue, AAlias, BAlias>>[] = [];
        const deltaA = this.#inputAPending.shift();
        const deltaB = this.#inputBPending.shift();

        if (deltaA !== undefined) {
          for (const x of deltaA.join(aAs, indexB, bAs, getBPrimaryKey)) {
            result.push(x);
          }
          indexA.extend(deltaA);
        }

        if (deltaB !== undefined) {
          for (const x of indexA.join(aAs, deltaB, bAs, getBPrimaryKey)) {
            result.push(x);
          }
          indexB.extend(deltaB);
        }

        indexA.compact(aKeysForCompaction);
        indexB.compact(bKeysForCompaction);
        results.push(result); // result.consolidate(x => x.id),
      }
      return flatMapIter(
        () => results,
        x => x,
      );
    };
    super(a, b, output, inner);
  }
}

// export
