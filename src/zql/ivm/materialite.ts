import {Comparator} from '@vlcn.io/ds-and-algos/types';
import {SourceInternal} from './source/source.js';
import {MutableSetSource} from './source/set-source.js';
import {Version} from './types.js';
import {must} from '../error/asserts.js';
import {DifferenceStream} from './graph/difference-stream.js';

export type MaterialiteInternal = {
  readonly materialite: Materialite;
  getVersion(): number;
  addDirtySource(source: SourceInternal): void;
  addDirtyNode(node: (version: Version) => void): void;
};

export class Materialite {
  #version: Version;
  #dirtySources: Set<SourceInternal> = new Set();
  #dirtyGraphNodes: Set<(version: Version) => void> = new Set();

  #currentTx: Version | null = null;
  #internal: MaterialiteInternal;

  constructor() {
    this.#version = 0;
    this.#internal = {
      materialite: this,
      getVersion: () => this.#version,
      addDirtySource: (source: SourceInternal) => {
        this.#dirtySources.add(source);
        // auto-commit if not in a transaction
        if (this.#currentTx === null) {
          this.#currentTx = this.#version + 1;
          this.#commit();
        }
      },
      addDirtyNode: (node: (version: Version) => void) => {
        this.#dirtyGraphNodes.add(node);
      },
    };
  }

  newSetSource<T extends object>(comparator: Comparator<T>) {
    return new MutableSetSource<T>(this.#internal, comparator);
  }

  newStream<T extends object>() {
    return new DifferenceStream<T>(this.#internal);
  }

  /**
   * Run the provided lambda in a transaciton.
   * Will be committed when the lambda exits
   * and all incremental computations that depend on modified inputs
   * will be run.
   *
   * An exception to this is in the case of nested transactions.
   * No incremental computation will run until the outermost transaction
   * completes.
   *
   * If the transaction throws, all pending inputs which were queued will be rolled back.
   * If a nested transaction throws, all transactions in the stack are rolled back.
   *
   * In this way, nesting transactions only exists to allow functions to be ignorant
   * of what transactions other functions that they call may create. It would be problematic
   * if creating transactions within transactions failed as it would preclude the use of
   * libraries that use transactions internally.
   */
  tx(fn: () => void) {
    if (this.#currentTx === null) {
      this.#currentTx = this.#version + 1;
    } else {
      // nested transaction
      // just run the function as we're already inside the
      // scope of a transaction that will handle rollback and commit.
      fn();
      return;
    }

    let userExceptions;
    try {
      fn();
      userExceptions = this.#commit();
    } catch (e) {
      this.#rollback();
      throw e;
    }

    if (userExceptions.length > 0) {
      throw userExceptions;
    }
  }

  #rollback() {
    this.#currentTx = null;
    for (const source of this.#dirtySources) {
      source.onRollback();
    }
  }

  #commit() {
    this.#version = must(this.#currentTx);
    this.#currentTx = null;
    for (const source of this.#dirtySources) {
      source.onCommitEnqueue(this.#version);
    }
    const userExceptions = [];

    for (const source of this.#dirtySources) {
      try {
        source.onCommit(this.#version);
      } catch (e) {
        userExceptions.push(e);
      }
    }

    // Graph is run synchronously so all nodes
    // would have run as soon as data is enqueued above.
    // rather then flow through the graph again to tell nodes
    // to notify their commit listeners, nodes that _have_ listeners
    // register with us. Only a fraction of nodes will have commit listeners (e.g., views and effects)
    for (const node of this.#dirtyGraphNodes) {
      try {
        node(this.#version);
      } catch (e) {
        // commit listeners are user code.
        userExceptions.push(e);
      }
    }

    this.#dirtySources.clear();
    this.#dirtyGraphNodes.clear();
    return userExceptions;
  }
}
