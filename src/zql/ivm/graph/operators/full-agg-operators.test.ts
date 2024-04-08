import {expect, test} from 'vitest';
import {Materialite} from '../../materialite.js';

const m = new Materialite();
test('count', () => {
  const input = m.newStream<{x: string}>();
  const output = input.count('count');
  const items: [{x: string}, number][] = [];
  output.effect((e, m) => {
    items.push([e, m]);
  });

  // does not count things that do not exist
  check(
    1,
    [
      [
        {
          x: 'foo',
        },
        0,
      ],
    ],
    [[{x: 'foo', count: 0}, 1]],
  );

  // counts multiplicity of 1
  check(
    2,
    [
      [
        {
          x: 'foo',
        },
        1,
      ],
    ],
    [
      [{x: 'foo', count: 0}, -1],
      [{x: 'foo', count: 1}, 1],
    ],
  );

  // decrements if an item is removed
  check(
    3,
    [
      [
        {
          x: 'foo',
        },
        -1,
      ],
    ],
    [
      [{x: 'foo', count: 1}, -1],
      [{x: 'foo', count: 0}, 1],
    ],
  );

  // double counts doubly present items
  check(
    4,
    [
      [
        {
          x: 'foo',
        },
        2,
      ],
    ],
    [
      [{x: 'foo', count: 0}, -1],
      [{x: 'foo', count: 2}, 1],
    ],
  );

  function check(
    version: number,
    data: [{x: string}, number][],
    expected: [{x: string; count: number}, number][],
  ) {
    items.length = 0;
    m.tx(() => {
      input.newData(version, data);
    });
    expect(items).toEqual(expected);
  }
});

test('average', () => {
  const input = m.newStream<{x: number}>();
  const output = input.average('x', 'x');
  const items: [{x: number}, number][] = [];
  output.effect((e, m) => {
    items.push([e, m]);
  });

  // does not avg things that do not exist
  check(
    1,
    [
      [
        {
          x: 1,
        },
        0,
      ],
    ],
    [[{x: 0}, 1]],
  );

  // averages things that exist
  check(
    2,
    [
      [
        {
          x: 1,
        },
        1,
      ],
      [
        {
          x: 2,
        },
        1,
      ],
      [
        {
          x: 3,
        },
        1,
      ],
    ],
    [
      [{x: 0}, -1],
      [{x: 2}, 1],
    ],
  );

  // updates the average when new items enter
  check(
    3,
    [
      [
        {
          x: 4,
        },
        1,
      ],
      [
        {
          x: 5,
        },
        1,
      ],
    ],
    [
      [{x: 2}, -1],
      [{x: 3}, 1],
    ],
  );

  // updates the average when items leave
  check(
    4,
    [
      [
        {
          x: 4,
        },
        -1,
      ],
      [
        {
          x: 5,
        },
        -1,
      ],
    ],
    [
      [{x: 3}, -1],
      [{x: 2}, 1],
    ],
  );

  function check(
    version: number,
    data: [{x: number}, number][],
    expected: [{x: number}, number][],
  ) {
    items.length = 0;
    m.tx(() => {
      input.newData(version, data);
    });
    expect(items).toEqual(expected);
  }
});

test('sum', () => {
  const input = m.newStream<{x: number}>();
  const output = input.sum('x', 'x');
  const items: [{x: number}, number][] = [];
  output.effect((e, m) => {
    items.push([e, m]);
  });

  // does not sum things that do not exist
  check(
    1,
    [
      [
        {
          x: 1,
        },
        0,
      ],
    ],
    [[{x: 0}, 1]],
  );

  // sums things that exist
  check(
    2,
    [
      [
        {
          x: 1,
        },
        1,
      ],
      [
        {
          x: 2,
        },
        1,
      ],
      [
        {
          x: 3,
        },
        1,
      ],
    ],
    [
      [{x: 0}, -1],
      [{x: 6}, 1],
    ],
  );

  // updates the sum when new items enter
  check(
    3,
    [
      [
        {
          x: 4,
        },
        1,
      ],
      [
        {
          x: 5,
        },
        1,
      ],
    ],
    [
      [{x: 6}, -1],
      [{x: 15}, 1],
    ],
  );

  // updates the sum when items leave
  check(
    4,
    [
      [
        {
          x: 4,
        },
        -1,
      ],
      [
        {
          x: 5,
        },
        -1,
      ],
    ],
    [
      [{x: 15}, -1],
      [{x: 6}, 1],
    ],
  );

  function check(
    version: number,
    data: [{x: number}, number][],
    expected: [{x: number}, number][],
  ) {
    items.length = 0;
    m.tx(() => {
      input.newData(version, data);
    });
    expect(items).toEqual(expected);
  }
});
