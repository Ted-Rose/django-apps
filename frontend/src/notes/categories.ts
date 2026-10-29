/**
 * Category-tree helpers for the flat `categories` array the notes
 * dashboard returns ([{id, name, slug, parent_id, note_count}]).
 * The tree is two levels deep by contract: parent_id=null → group,
 * otherwise a leaf under that group.
 */
import type { NoteCategoryOut } from './api';

export interface CategoryNode {
  category: NoteCategoryOut;
  children: NoteCategoryOut[];
}

/** One row of the flattened tree, ready to render with a depth. */
export interface CategoryRow {
  category: NoteCategoryOut;
  /** 0 = group, 1 = leaf under a group. */
  depth: 0 | 1;
}

/**
 * Groups (parent_id null) each carrying their leaves, ordered like
 * the API's flat list — the backend emits categories in id order,
 * which keeps a stable tree without a sort of its own.
 */
export function buildCategoryTree(
  categories: NoteCategoryOut[],
): CategoryNode[] {
  const nodes: CategoryNode[] = [];
  const byId = new Map<number, CategoryNode>();
  for (const category of categories) {
    if (category.parent_id == null) {
      const node = { category, children: [] };
      nodes.push(node);
      byId.set(category.id, node);
    }
  }
  for (const category of categories) {
    if (category.parent_id == null) continue;
    const parent = byId.get(category.parent_id);
    // Orphaned leaves (parent deleted before them) fold into a
    // synthetic top-level slot rather than vanishing from pickers.
    if (parent) {
      parent.children.push(category);
    } else {
      nodes.push({ category, children: [] });
    }
  }
  return nodes;
}

/**
 * Depth-annotated flat list — group row, then its leaves indented,
 * then the next group. What the navbar dropdown and the category
 * pickers iterate.
 */
export function flattenCategoryTree(
  categories: NoteCategoryOut[],
): CategoryRow[] {
  const rows: CategoryRow[] = [];
  for (const node of buildCategoryTree(categories)) {
    rows.push({ category: node.category, depth: 0 });
    for (const child of node.children) {
      rows.push({ category: child, depth: 1 });
    }
  }
  return rows;
}

/**
 * The note_count a filter selection displays: a group's count is
 * its own notes plus every leaf's (the API's category filter is
 * subtree-aware).
 */
export function subtreeNoteCount(
  categories: NoteCategoryOut[],
  categoryId: number,
): number {
  let total = 0;
  for (const category of categories) {
    if (category.id === categoryId || category.parent_id === categoryId) {
      total += category.note_count ?? 0;
    }
  }
  return total;
}

/** Display path for a category: 'leaf' or 'group / leaf'. */
export function categoryPathLabel(
  categories: NoteCategoryOut[],
  categoryId: number,
): string {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const category = byId.get(categoryId);
  if (!category) return '';
  const parent =
    category.parent_id != null ? byId.get(category.parent_id) : null;
  return parent ? `${parent.name} / ${category.name}` : category.name;
}
