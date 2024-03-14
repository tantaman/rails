import {expect, test} from 'vitest';
import {z} from 'zod';
import {generate} from '../generate.js';
import {makeReplicacheContext} from './context/replicache-context.js';
import {Replicache, TEST_LICENSE_KEY} from 'replicache';
import {nanoid} from 'nanoid';
import fc from 'fast-check';
import {EntityQueryImpl} from './query/entity-query.js';

const issueSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['open', 'closed']),
  priority: z.enum(['high', 'medium', 'low']),
  assignee: z.string(),
  created: z.date(),
  updated: z.date(),
  closed: z.date().optional(),
});

type Issue = z.infer<typeof issueSchema>;

const {
  init: initIssue,
  set: setIssue,
  update: updateIssue,
  delete: deleteIssue,
} = generate<Issue>('issue', issueSchema.parse);

const mutators = {
  initIssue,
  setIssue,
  updateIssue,
  deleteIssue,
};

function newRep() {
  return new Replicache({
    licenseKey: TEST_LICENSE_KEY,
    name: nanoid(),
    mutators,
  });
}

const issueArbitrary: fc.Arbitrary<Issue> = fc.record({
  id: fc.string({
    minLength: 1,
    maxLength: 10,
  }),
  title: fc.string(),
  status: fc.constantFrom('open', 'closed'),
  priority: fc.constantFrom('high', 'medium', 'low'),
  assignee: fc.string(),
  created: fc.date(),
  updated: fc.date(),
  closed: fc.option(fc.date(), {nil: undefined}),
});

// const operators = ['=', '<', '>', '>=', '<=', 'IN', 'LIKE', 'ILIKE'] as const;

const tenUniqueIssues = fc.uniqueArray(issueArbitrary, {
  comparator: (a, b) => a.id === b.id,
  minLength: 10,
  maxLength: 10,
});

// TODO: we have to make this non-empty for now
// otherwise we will infinitely hang.
// See comment about `experimentalWatch` in the first test.
const uniqueNonEmptyIssuesArbitrary = fc.uniqueArray(issueArbitrary, {
  comparator: (a, b) => a.id === b.id,
  minLength: 1,
  maxLength: 10,
});

function sampleTenUniqueIssues() {
  return fc.sample(tenUniqueIssues, 1)[0];
}

function setup() {
  const r = newRep();
  const c = makeReplicacheContext(r);
  const q = new EntityQueryImpl<{fields: Issue}>(c, 'issue');
  return {r, c, q};
}

const compareIds = (a: {id: string}, b: {id: string}) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function makeComparator(...fields: (keyof Issue)[]) {
  return (l: Partial<Issue>, r: Partial<Issue>) => {
    for (const field of fields) {
      const lVal = l[field];
      const rVal = r[field];
      if (lVal === rVal) {
        continue;
      }
      if (lVal === null || lVal === undefined) {
        return -1;
      }
      if (rVal === null || rVal === undefined) {
        return 1;
      }
      return lVal < rVal ? -1 : lVal > rVal ? 1 : 0;
    }
    return 0;
  };
}

// function reverseComparator(
//   c: (l: Partial<Issue>, r: Partial<Issue>) => number,
// ) {
//   return (l: Partial<Issue>, r: Partial<Issue>) => -1 * c(r, l);
// }

// This test fails because `experimentalWatch` does not call us with an empty array when we want initial data from an empty collection.
// So we wait for forever for data to be available.
test('1-shot against an empty collection', async () => {
  expect(
    'This test fails because `experimentalWatch` does not call us with an empty array when we want initial data from an empty collection. So we wait for forever for data to be available.',
  ).toEqual('');
  const {q} = setup();
  const rows = await q.select('id').prepare().exec();
  expect(rows).toEqual([]);
});

test('prepare a query before the collection has writes then run it', async () => {
  const issues = sampleTenUniqueIssues();
  const {q, r} = setup();
  const stmt = q.select('id').prepare();
  await Promise.all(issues.map(r.mutate.initIssue));

  const rows = await stmt.exec();
  expect(rows).toEqual(issues.map(({id}) => ({id})).sort(compareIds));

  await r.close();
});

test('prepare a query then run it once `experimentalWatch` has completed', async () => {
  const issues = sampleTenUniqueIssues();
  const {q, r} = setup();
  await Promise.all(issues.map(r.mutate.initIssue));

  const stmt = q.select('id').prepare();
  // This is a hacky way to wait for the watch to complete.
  await new Promise(resolve => setTimeout(resolve, 0));
  const rows = await stmt.exec();

  expect(rows).toEqual(issues.map(({id}) => ({id})).sort(compareIds));

  await r.close();
});

test('exec a query before the source has been filled by anything', async () => {
  const issues = sampleTenUniqueIssues();
  const {q, r} = setup();
  await Promise.all(issues.map(r.mutate.initIssue));

  // it should wait until the source has been seeded
  // before returning.
  const rows = await q.select('id').prepare().exec();

  expect(rows).toEqual(issues.map(({id}) => ({id})).sort(compareIds));

  await r.close();
});

test('subscribing to a query calls us with the complete query results on change', async () => {
  const issues = sampleTenUniqueIssues();
  const {q, r} = setup();
  await Promise.all(issues.map(r.mutate.initIssue));

  let called: (v: unknown) => void;
  const calledPromise = new Promise(resolve => {
    called = resolve;
  });

  let callCount = 0;
  q.select('id')
    .prepare()
    .subscribe(value => {
      expect(value).toEqual(issues.map(({id}) => ({id})).sort(compareIds));
      if (callCount === 0) {
        called(value);
      }
      ++callCount;
    });

  // make sure our subscription actually gets called with initial data!
  await calledPromise;

  // retract some issues
  const deletedIssues = issues.slice(0, 5);

  let lastCallCount = callCount;
  for (const issue of deletedIssues) {
    issues.shift();
    await r.mutate.deleteIssue(issue.id);
    // check that our observer was called after each deletion.
    // TODO: if a mutator deletes many things in a single
    // transaction, we need to tie that to the lifetime of
    // a Materialite transaction. So observers are not notified
    // until the full Replicache mutation completes.
    expect(callCount).toBe(lastCallCount + 1);
    lastCallCount = callCount;
  }

  await r.close();
});

test('subscribing to differences', () => {});

test('each where operator', async () => {
  // go through each operator
  // double check it against a `filter` in JS
  const now = new Date();
  const future = new Date(now.getTime() + 1000);
  const past = new Date(now.getTime() - 1000);
  const issues: Issue[] = [
    {
      id: 'a',
      title: 'a',
      status: 'open',
      priority: 'high',
      assignee: 'charles',
      created: past,
      updated: new Date(),
    },
    {
      id: 'b',
      title: 'b',
      status: 'open',
      priority: 'medium',
      assignee: 'bob',
      created: now,
      updated: new Date(),
    },
    {
      id: 'c',
      title: 'c',
      status: 'closed',
      priority: 'low',
      assignee: 'alice',
      created: future,
      updated: new Date(),
    },
  ];

  const {q, r} = setup();
  await Promise.all(issues.map(r.mutate.initIssue));

  let stmt = q.select('id').where('id', '=', 'a').prepare();
  const rows = await stmt.exec();
  expect(rows).toEqual([{id: 'a'}]);
  stmt.destroy();

  stmt = q.select('id').where('id', '<', 'b').prepare();
  expect(await stmt.exec()).toEqual([{id: 'a'}]);
  stmt.destroy();

  stmt = q.select('id').where('id', '>', 'a').prepare();
  expect(await stmt.exec()).toEqual([{id: 'b'}, {id: 'c'}]);
  stmt.destroy();

  stmt = q.select('id').where('id', '>=', 'b').prepare();
  expect(await stmt.exec()).toEqual([{id: 'b'}, {id: 'c'}]);
  stmt.destroy();

  stmt = q.select('id').where('id', '<=', 'b').prepare();
  expect(await stmt.exec()).toEqual([{id: 'a'}, {id: 'b'}]);
  stmt.destroy();

  // TODO: this breaks
  // stmt = q.select('id').where('id', 'IN', ['a', 'b']).prepare();
  // expect(await stmt.exec()).toEqual([{id: 'a'}, {id: 'b'}]);
  // stmt.destroy();

  stmt = q.select('id').where('assignee', 'LIKE', 'al').prepare();
  expect(await stmt.exec()).toEqual([{id: 'c'}]);
  stmt.destroy();

  stmt = q.select('id').where('assignee', 'ILIKE', 'AL').prepare();
  expect(await stmt.exec()).toEqual([{id: 'c'}]);
  stmt.destroy();

  // now compare against created date
  // TODO: this breaks
  // stmt = q.select('id').where('created', '=', now).prepare();
  // expect(await stmt.exec()).toEqual([{id: 'b'}]);
  // stmt.destroy();

  stmt = q.select('id').where('created', '<', now).prepare();
  expect(await stmt.exec()).toEqual([{id: 'a'}]);
  stmt.destroy();

  stmt = q.select('id').where('created', '>', now).prepare();
  expect(await stmt.exec()).toEqual([{id: 'c'}]);
  stmt.destroy();

  stmt = q.select('id').where('created', '>=', now).prepare();
  expect(await stmt.exec()).toEqual([{id: 'b'}, {id: 'c'}]);
  stmt.destroy();

  stmt = q.select('id').where('created', '<=', now).prepare();
  expect(await stmt.exec()).toEqual([{id: 'a'}, {id: 'b'}]);
  stmt.destroy();

  await r.close();
});

test('order by single field', async () => {
  await fc.assert(
    fc.asyncProperty(uniqueNonEmptyIssuesArbitrary, async issues => {
      const {q, r} = setup();
      await Promise.all(issues.map(r.mutate.initIssue));

      const compareAssignees = makeComparator('assignee', 'id');
      const stmt = q.select('id', 'assignee').asc('assignee').prepare();
      const rows = await stmt.exec();
      try {
        expect(rows).toEqual(
          issues
            .map(({id, assignee}) => ({id, assignee}))
            .sort(compareAssignees),
        );
      } finally {
        await r.close();
      }
    }),
  );
});

test('order by id', async () => {
  await fc.assert(
    fc.asyncProperty(uniqueNonEmptyIssuesArbitrary, async issues => {
      const {q, r} = setup();
      await Promise.all(issues.map(r.mutate.initIssue));

      const stmt = q.select('id').asc('id').prepare();
      const rows = await stmt.exec();
      expect(rows).toEqual(issues.map(({id}) => ({id})).sort(compareIds));

      await r.close();
    }),
  );
});

test('order by compound fields', async () => {
  await fc.assert(
    fc.asyncProperty(uniqueNonEmptyIssuesArbitrary, async issues => {
      const {q, r} = setup();
      await Promise.all(issues.map(r.mutate.initIssue));

      const compareExpected = makeComparator('assignee', 'created', 'id');
      const stmt = q
        .select('id', 'assignee', 'created')
        .asc('assignee', 'created')
        .prepare();
      const rows = await stmt.exec();
      expect(rows).toEqual(
        issues
          .map(({id, created, assignee}) => ({id, created, assignee}))
          .sort(compareExpected),
      );

      await r.close();
    }),
  );
});

test('order by optional field', async () => {
  await fc.assert(
    fc.asyncProperty(uniqueNonEmptyIssuesArbitrary, async issues => {
      const {q, r} = setup();
      await Promise.all(issues.map(r.mutate.initIssue));

      const compareExpected = makeComparator('closed', 'id');
      const stmt = q.select('id', 'closed').asc('closed').prepare();
      const rows = await stmt.exec();
      expect(rows).toEqual(
        issues.map(({id, closed}) => ({id, closed})).sort(compareExpected),
      );

      await r.close();
    }),
  );
});

test('join', () => {});
test('having', () => {});
test('group by', () => {});
test('limit', () => {});
test('after', () => {});
test('sorted groupings', () => {});
test('adding items late to a source materializes them in the correct order', () => {});
test('disposing of a subscription causes us to no longer be called back', () => {});

test('hoisting `after` operations to the source', () => {});
test('hoisting `limit` operations to the source', () => {});
test('hoisting `where` operations to the source', () => {});

test('order by joined in fields', () => {});

test('correctly sorted source is used to optimize joins', () => {});

test('order-by selects the correct source', () => {});

test('write delay with 1, 10, 100, 1000s of active queries', () => {});

test('asc/desc difference does not create new sources', () => {});

test('we do not do a full scan when the source order matches the view order', () => {});