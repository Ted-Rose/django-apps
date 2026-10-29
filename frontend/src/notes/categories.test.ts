import { describe, expect, it } from 'vitest';
import type { NoteCategoryOut } from './api';
import {
  buildCategoryTree,
  categoryPathLabel,
  flattenCategoryTree,
  subtreeNoteCount,
} from './categories';

function makeCategory(
  overrides: Partial<NoteCategoryOut> = {},
): NoteCategoryOut {
  return {
    id: 1,
    name: 'Category',
    slug: 'category',
    parent_id: null,
    note_count: 0,
    ...overrides,
  };
}

const TREE: NoteCategoryOut[] = [
  makeCategory({ id: 1, name: 'God', slug: 'god' }),
  makeCategory({
    id: 2,
    name: 'Prayer',
    slug: 'prayer',
    parent_id: 1,
    note_count: 3,
  }),
  makeCategory({
    id: 3,
    name: 'Church',
    slug: 'church',
    parent_id: 1,
    note_count: 1,
  }),
  makeCategory({ id: 4, name: 'Projects', slug: 'projects', note_count: 2 }),
  makeCategory({
    id: 5,
    name: 'Django Apps',
    slug: 'django-apps',
    parent_id: 4,
    note_count: 5,
  }),
];

describe('buildCategoryTree', () => {
  it('groups leaves under their parents in order', () => {
    const tree = buildCategoryTree(TREE);
    expect(tree.map((n) => n.category.id)).toEqual([1, 4]);
    expect(tree[0].children.map((c) => c.id)).toEqual([2, 3]);
    expect(tree[1].children.map((c) => c.id)).toEqual([5]);
  });

  it('keeps orphaned leaves as top-level nodes', () => {
    const tree = buildCategoryTree([
      makeCategory({ id: 9, name: 'Orphan', slug: 'orphan', parent_id: 99 }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].category.id).toBe(9);
    expect(tree[0].children).toEqual([]);
  });
});

describe('flattenCategoryTree', () => {
  it('emits each group followed by its depth-1 leaves', () => {
    const rows = flattenCategoryTree(TREE);
    expect(rows.map((r) => [r.category.id, r.depth])).toEqual([
      [1, 0],
      [2, 1],
      [3, 1],
      [4, 0],
      [5, 1],
    ]);
  });
});

describe('subtreeNoteCount', () => {
  it('sums a group with its leaves but leaves stay their own', () => {
    expect(subtreeNoteCount(TREE, 1)).toBe(4);
    expect(subtreeNoteCount(TREE, 2)).toBe(3);
    expect(subtreeNoteCount(TREE, 4)).toBe(7);
  });
});

describe('categoryPathLabel', () => {
  it('renders leaf paths as "group / leaf" and groups bare', () => {
    expect(categoryPathLabel(TREE, 2)).toBe('God / Prayer');
    expect(categoryPathLabel(TREE, 4)).toBe('Projects');
    expect(categoryPathLabel(TREE, 42)).toBe('');
  });
});
