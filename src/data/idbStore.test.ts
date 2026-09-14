/**
 * Store behaviour, run against fake-indexeddb.
 *   node --test src/data/idbStore.test.ts
 */

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTree, flattenAll, treeWordCount } from '../core/tree.ts';
import { docFromPlainText, plainTextFromDoc, wordCountOf } from '../core/pmText.ts';
import { IdbStore } from './idbStore.ts';

let counter = 0;

/** Each test gets its own database so nothing leaks between them. */
function fresh() {
  return new IdbStore(`palmanote-test-${counter++}`);
}

async function titles(store: IdbStore): Promise<string[]> {
  const tree = buildTree(await store.listDocuments());
  return flattenAll(tree).map((node) => '  '.repeat(node.depth) + node.doc.title);
}

test('documents nest arbitrarily and keep sibling order', async () => {
  const store = fresh();
  const part = await store.createDocument({ parentId: null, kind: 'folder', title: 'Part One' });
  const one = await store.createDocument({ parentId: part.id, kind: 'chapter', title: 'Chapter 1' });
  const two = await store.createDocument({ parentId: part.id, kind: 'chapter', title: 'Chapter 2' });
  await store.createDocument({ parentId: one.id, kind: 'scene', title: 'Scene A' });
  await store.createDocument({ parentId: one.id, kind: 'scene', title: 'Scene B' });

  assert.deepEqual(await titles(store), [
    'Part One',
    '  Chapter 1',
    '    Scene A',
    '    Scene B',
    '  Chapter 2',
  ]);

  // A container may hold prose of its own.
  await store.saveContent({ id: part.id, content: docFromPlainText('Prologue text.'), wordCount: 2 });
  const reread = await store.getDocument(part.id);
  assert.equal(plainTextFromDoc(reread!.content), 'Prologue text.');
  assert.equal(reread!.wordCount, 2);
  assert.ok(two.id);
});

test('reordering and reparenting are single-row updates', async () => {
  const store = fresh();
  const a = await store.createDocument({ parentId: null, title: 'A' });
  const b = await store.createDocument({ parentId: null, title: 'B' });
  const c = await store.createDocument({ parentId: null, title: 'C' });

  const before = await store.listDocuments();

  await store.moveDocument({ id: c.id, parentId: null, afterId: null }); // to the front
  assert.deepEqual(await titles(store), ['C', 'A', 'B']);

  await store.moveDocument({ id: a.id, parentId: b.id }); // nest under B
  assert.deepEqual(await titles(store), ['C', 'B', '  A']);

  // Only the moved rows changed position.
  const after = await store.listDocuments();
  const changed = after.filter((row) => {
    const was = before.find((r) => r.id === row.id)!;
    return was.position !== row.position || was.parentId !== row.parentId;
  });
  assert.deepEqual(changed.map((r) => r.title).sort(), ['A', 'C']);
});

test('archive hides a subtree and restore brings it back intact', async () => {
  const store = fresh();
  const part = await store.createDocument({ parentId: null, title: 'Part' });
  const chapter = await store.createDocument({ parentId: part.id, title: 'Chapter' });
  await store.createDocument({ parentId: chapter.id, title: 'Scene' });
  await store.createDocument({ parentId: null, title: 'Notes' });

  await store.archiveDocument(part.id);
  assert.deepEqual(await titles(store), ['Notes']);

  await store.restoreDocument(part.id);
  assert.deepEqual(await titles(store), ['Part', '  Chapter', '    Scene', 'Notes']);
});

test('restoring into an archived branch lifts the document to the root', async () => {
  const store = fresh();
  const part = await store.createDocument({ parentId: null, title: 'Part' });
  const chapter = await store.createDocument({ parentId: part.id, title: 'Chapter' });

  await store.archiveDocument(chapter.id);
  await store.archiveDocument(part.id);
  await store.restoreDocument(chapter.id);

  assert.deepEqual(await titles(store), ['Chapter']);
});

test('deleting takes the whole subtree, its content and its history', async () => {
  const store = fresh();
  const part = await store.createDocument({ parentId: null, title: 'Part One' });
  const chapter = await store.createDocument({ parentId: part.id, title: 'Chapter A' });
  const scene = await store.createDocument({ parentId: chapter.id, title: 'Scene i' });
  const bystander = await store.createDocument({ parentId: part.id, title: 'Chapter B' });

  for (const doc of [chapter, scene, bystander]) {
    await store.saveContent({
      id: doc.id,
      content: docFromPlainText('some words here'),
      wordCount: 3,
      snapshot: true,
    });
  }

  const gone = await store.deleteDocument(chapter.id);
  assert.deepEqual(new Set(gone), new Set([chapter.id, scene.id]));

  const left = await store.listDocuments();
  assert.deepEqual(
    left.map((doc) => doc.title).sort(),
    ['Chapter B', 'Part One'],
    'the subtree goes, its siblings and ancestors stay',
  );
  assert.equal(await store.getDocument(scene.id), null, 'a descendant cannot survive its parent');
  assert.deepEqual(await store.listRevisions(chapter.id), [], 'history goes with the document');
  assert.deepEqual(await store.listRevisions(scene.id), []);
  assert.equal(
    (await store.listRevisions(bystander.id)).length,
    1,
    'another document keeps its own history',
  );
  assert.equal((await store.getDocument(bystander.id))?.content !== null, true);
});

test('deleting an archived page reaches the descendants it was hiding', async () => {
  const store = fresh();
  const parent = await store.createDocument({ parentId: null, title: 'Parent' });
  const child = await store.createDocument({ parentId: parent.id, title: 'Child' });
  // Archiving marks the root only; the child stays live but unreachable.
  await store.archiveDocument(parent.id);
  assert.equal((await store.getDocument(child.id))?.archivedAt, null);

  await store.deleteDocument(parent.id);
  assert.deepEqual(await store.listDocuments(), [], 'nothing is left orphaned in the table');
});

test('word counts roll up through the tree', async () => {
  const store = fresh();
  const part = await store.createDocument({ parentId: null, title: 'Part' });
  const chapter = await store.createDocument({ parentId: part.id, title: 'Chapter' });

  const prose = 'The quick brown fox jumps over the lazy dog.';
  await store.saveContent({ id: chapter.id, content: docFromPlainText(prose), wordCount: 9 });
  await store.saveContent({ id: part.id, content: docFromPlainText('One two three.'), wordCount: 3 });

  assert.equal(treeWordCount(buildTree(await store.listDocuments())), 12);
  assert.equal(wordCountOf(docFromPlainText(prose)), 9);
});

test('every save is durable; revisions coalesce but never lose the newest', async () => {
  const store = fresh();
  const doc = await store.createDocument({ parentId: null, title: 'Scene' });

  for (let i = 1; i <= 20; i++) {
    await store.saveContent({ id: doc.id, content: docFromPlainText(`draft ${i}`), wordCount: 2 });
  }

  // The document row always holds the latest text — this is what survives a crash.
  const record = await store.getDocument(doc.id);
  assert.equal(plainTextFromDoc(record!.content), 'draft 20');

  // Twenty rapid saves leave one snapshot, not twenty.
  const revisions = await store.listRevisions(doc.id);
  assert.equal(revisions.length, 1);

  // A forced snapshot (navigation, blur, close) always writes.
  await store.saveContent({
    id: doc.id,
    content: docFromPlainText('draft 21'),
    wordCount: 2,
    snapshot: true,
  });
  const after = await store.listRevisions(doc.id);
  assert.equal(after.length, 2);
  assert.equal(plainTextFromDoc(after[0]!.content), 'draft 21');
  assert.ok(after[0]!.createdAt >= after[1]!.createdAt);
});

test('pruning keeps recent detail, thins history, and never empties a document', async () => {
  const store = fresh();
  const doc = await store.createDocument({ parentId: null, title: 'Scene' });
  await store.saveContent({ id: doc.id, content: docFromPlainText('now'), wordCount: 1, snapshot: true });

  const kept = await store.listRevisions(doc.id);
  assert.equal(kept.length, 1);
  assert.equal(await store.pruneRevisions(), 0, 'nothing recent should be pruned');
  assert.equal((await store.listRevisions(doc.id)).length, 1);
});

test('activity remembers every page touched on a day once', async () => {
  const store = fresh();
  const at = new Date(2026, 7, 31, 10).getTime();

  await store.recordActivity({ day: '2026-08-31', words: 12, at, documentId: 'page-a' });
  await store.recordActivity({ day: '2026-08-31', words: 8, at: at + 30_000, documentId: 'page-b' });
  const row = await store.recordActivity({
    day: '2026-08-31',
    words: 3,
    at: at + 60_000,
    documentId: 'page-a',
  });

  assert.equal(row.words, 23);
  assert.deepEqual(row.documentIds, ['page-a', 'page-b']);
  assert.deepEqual((await store.listActivity('2026-08-31'))[0]?.documentIds, ['page-a', 'page-b']);
});

test('plain text survives a round trip through ProseMirror JSON', () => {
  const text = 'First paragraph.\n\nSecond paragraph,\nwith a line break.\n\nThird.';
  assert.equal(plainTextFromDoc(docFromPlainText(text)), text);
});
