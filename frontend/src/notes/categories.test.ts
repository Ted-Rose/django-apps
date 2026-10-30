import { describe, expect, it } from 'vitest';
import type { NoteCategoryOut } from './api';
import {
  buildCategoryTree,
  categoryPathLabel,
  descendantIds,
  flattenCategoryTree,
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

// god → prayer → morning plus projects → django → apps — covers
// depth 3; note_count values stand in for the API's subtree
// totals, which the rows render verbatim.
const TREE: NoteCategoryOut[] = [
  makeCategory({ id: 1, name: 'God', slug: 'god', note_count: 4 }),
  makeCategory({
    id: 2,
    name: 'Prayer',
    slug: 'prayer',
    parent_id: 1,
    note_count: 3,
  }),
  makeCategory({
    id: 3,
    name: 'Morning',
    slug: 'morning',
    parent_id: 2,
    note_count: 1,
  }),
  makeCategory({ id: 4, name: 'Projects', slug: 'projects', note_count: 7 }),
  makeCategory({
    id: 5,
    name: 'Django',
    slug: 'django',
    parent_id: 4,
    note_count: 5,
  }),
  makeCategory({
    id: 6,
    name: 'Apps',
    slug: 'apps',
    parent_id: 5,
    note_count: 2,
  }),
];

describe('buildCategoryTree', () => {
  it('nests children under their parents at any depth', () => {
    const tree = buildCategoryTree(TREE);
    expect(tree.map((n) => n.category.id)).toEqual([1, 4]);
    expect(tree[0].children.map((c) => c.category.id)).toEqual([2]);
    const godDepthTwo = tree[0].children[0].children.map((c) => c.category.id);
    const projectsDepthTwo = tree[1].children[0].children.map(
      (c) => c.category.id,
    );
    expect(godDepthTwo).toEqual([3]);
    expect(projectsDepthTwo).toEqual([6]);
  });

  it('nests a child listed before its parent', () => {
    const tree = buildCategoryTree([
      makeCategory({ id: 9, name: 'Child', slug: 'c', parent_id: 10 }),
      makeCategory({ id: 10, name: 'Parent', slug: 'p' }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].category.id).toBe(10);
    expect(tree[0].children[0].category.id).toBe(9);
  });

  it('keeps orphaned nodes as top-level roots', () => {
    const tree = buildCategoryTree([
      makeCategory({ id: 9, name: 'Orphan', slug: 'orphan', parent_id: 99 }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].category.id).toBe(9);
    expect(tree[0].children).toEqual([]);
  });
});

describe('flattenCategoryTree', () => {
  it('emits depth-annotated rows for the whole tree', () => {
    const rows = flattenCategoryTree(TREE);
    expect(rows.map((r) => [r.category.id, r.depth])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 0],
      [5, 1],
      [6, 2],
    ]);
    expect(rows.map((r) => r.hasChildren)).toEqual([
      true,
      true,
      false,
      true,
      true,
      false,
    ]);
  });
});

describe('descendantIds', () => {
  it('covers the whole subtree, not just direct children', () => {
    expect([...descendantIds(TREE, 1)].sort()).toEqual([2, 3]);
    expect([...descendantIds(TREE, 4)].sort()).toEqual([5, 6]);
    expect([...descendantIds(TREE, 6)]).toEqual([]);
  });
});

describe('categoryPathLabel', () => {
  it('renders the full ancestor chain at any depth', () => {
    expect(categoryPathLabel(TREE, 3)).toBe('God / Prayer / Morning');
    expect(categoryPathLabel(TREE, 6)).toBe('Projects / Django / Apps');
    expect(categoryPathLabel(TREE, 4)).toBe('Projects');
    expect(categoryPathLabel(TREE, 42)).toBe('');
  });
});
