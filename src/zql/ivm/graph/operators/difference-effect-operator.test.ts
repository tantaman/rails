import {expect, test} from 'vitest';
import {Materialite} from '../../materialite.js';

type E = {x: number};
const m = new Materialite();
test('calls effect with raw difference events', () => {
  const input = m.newStream<E>();

  let called = false;
  let value;
  let mult = 0;
  input.effect((v, m) => {
    called = true;
    value = v;
    mult = m;
  });

  m.tx(() => {
    input.newData(1, [[{x: 1}, 1]]);
    // effect not run until commit
    expect(called).toBe(false);
  });

  expect(called).toBe(true);
  expect(value).toEqual({x: 1});
  expect(mult).toBe(1);

  called = false;
  value = 0;
  mult = 0;

  m.tx(() => {
    input.newData(2, [[{x: 1}, -1]]);
    // effect not run until commit
    expect(called).toBe(false);
  });

  expect(called).toBe(true);
  expect(value).toEqual({x: 1});
  expect(mult).toBe(-1);
});
