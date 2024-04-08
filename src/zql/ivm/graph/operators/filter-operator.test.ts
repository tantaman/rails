import {expect, test} from 'vitest';
import {Entry, Multiset} from '../../multiset.js';
import {Version} from '../../types.js';
import {Materialite} from '../../materialite.js';

type E = {id: number};

const m = new Materialite();
test('does not emit any rows that fail the filter', () => {
  const input = m.newStream<E>();

  const out = input.filter(_ => false);
  const items: E[] = [];
  out.effect((e: E) => {
    items.push(e);
  });

  m.tx(() => {
    input.newData(1, [
      [{id: 1}, 1],
      [{id: 2}, 2],
      [{id: 1}, -1],
      [{id: 2}, -2],
    ]);
  });

  expect(items.length).toBe(0);
});

test('emits all rows that pass the filter (including deletes / retractions)', () => {
  const input = m.newStream<E>();
  const out = input.filter(_ => true);

  const items: Entry<E>[] = [];
  out.effect((e: E, mult: number) => {
    items.push([e, mult]);
  });

  m.tx(() => {
    input.newData(1, [
      [{id: 1}, 1],
      [{id: 2}, 2],
      [{id: 1}, -1],
      [{id: 2}, -2],
    ]);
  });

  expect(items).toEqual([
    [{id: 1}, 1],
    [{id: 2}, 2],
    [{id: 1}, -1],
    [{id: 2}, -2],
  ]);
});

test('test that filter is lazy / the filter is not actually run until we pull on it', () => {
  const input = m.newStream<E>();
  let called = false;
  const out = input.filter(_ => {
    called = true;
    return true;
  });
  const msgs: Multiset<E>[] = [];
  out.debug((_: Version, data: Multiset<E>) => {
    msgs.push(data);
  });

  input.newData(1, [
    [{id: 1}, 1],
    [{id: 2}, 2],
    [{id: 1}, -1],
    [{id: 2}, -2],
  ]);

  // we run the graph but the filter is not run until we pull on it
  expect(called).toBe(false);

  // consume all the rows
  for (const m of msgs) {
    expect([...m]).toEqual([
      [{id: 1}, 1],
      [{id: 2}, 2],
      [{id: 1}, -1],
      [{id: 2}, -2],
    ]);
  }

  expect(called).toBe(true);
});
