import {expect, test} from 'vitest';
import {Multiset} from '../../multiset.js';
import {Materialite} from '../../materialite.js';

const m = new Materialite();
test('All branches notify', () => {
  type T = {x: number};
  const inputs = [m.newStream<T>(), m.newStream<T>(), m.newStream<T>()];
  const output = inputs[0].concat([inputs[1], inputs[2]]);

  let version = 1;

  const items: Multiset<T>[] = [];
  output.debug((v, d) => {
    expect(v).toBe(version);
    items.push(d);
  });

  inputs[0].newData(version, [
    [{x: 1}, 1],
    [{x: 2}, 2],
  ]);

  expect(items).toEqual([
    [
      [{x: 1}, 1],
      [{x: 2}, 2],
    ],
  ]);

  items.length = 0;
  version++;

  inputs[0].newData(version, [[{x: 0}, 1]]);
  inputs[1].newData(version, [[{x: 1}, 1]]);
  inputs[2].newData(version, [[{x: 2}, 2]]);
  expect(items).toEqual([[[{x: 0}, 1]], [[{x: 1}, 1]], [[{x: 2}, 2]]]);
});

test('Test with single input', () => {
  type T = {x: number};
  const input = m.newStream<T>();

  const output = input.concat([]);

  const version = 1;

  const items: Multiset<T>[] = [];
  output.debug((v, d) => {
    expect(v).toBe(version);
    items.push(d);
  });

  input.newData(version, [
    [{x: 1}, 1],
    [{x: 2}, 2],
  ]);

  expect(items).toEqual([
    [
      [{x: 1}, 1],
      [{x: 2}, 2],
    ],
  ]);
});
