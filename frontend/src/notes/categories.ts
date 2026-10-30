/**
 * Category-tree helpers for the flat `categories` array the notes
 * dashboard returns ([{id, name, slug, parent_id, note_count}]).
 * The tree nests ARBITRARILY deep — every '-' segment of a
 * `#notes-…` marker is one level — and `note_count` is already a
 * subtree total server-side, so rows render it verbatim.
 */
import type { NoteCategoryOut } from './api';

export interface CategoryNode {
  category: NoteCategoryOut;
  children: CategoryNode[];
}

/** One row of the flattened tree, ready to render with a depth. */
export interface CategoryRow {
  category: NoteCategoryOut;
  /** 0 = top level, +1 per ancestor. */
  depth: number;
  /** Folder vs leaf icon hint — nodes with children read as dirs. */
  hasChildren: boolean;
}

/**
 * The forest under the tree roots (parent_id null), every node
 * carrying its children. The API emits categories name-ordered;
 * building the id map first means a child listed before its
 * parent still nests correctly, and keeps a stable tree without a
 * sort of its own.
 */
export function buildCategoryTree(
  categories: NoteCategoryOut[],
): CategoryNode[] {
  const byId = new Map<number, CategoryNode>();
  for (const category of categories) {
    byId.set(category.id, { category, children: [] });
  }
  const roots: CategoryNode[] = [];
  for (const category of categories) {
    const node = byId.get(category.id);
    if (!node) continue;
    const parent =
      category.parent_id != null ? byId.get(category.parent_id) : undefined;
    if (parent && parent !== node) {
      parent.children.push(node);
    } else {
      // Top-level — or an orphan whose parent id points at a
      // deleted/missing category; folding to a root keeps it
      // visible in pickers instead of vanishing.
      roots.push(node);
    }
  }
  // Paranoia: a parent-cycle in corrupted data would hide every
  // node in the loop — anything unreachable from the roots
  // surfaces as a root instead.
  const seen = new Set<number>();
  const queue = [...roots];
  while (queue.length > 0) {
    const node = queue.shift() as CategoryNode;
    if (seen.has(node.category.id)) continue;
    seen.add(node.category.id);
    queue.push(...node.children);
  }
  for (const node of byId.values()) {
    if (!seen.has(node.category.id)) {
      roots.push(node);
    }
  }
  return roots;
}

/**
 * Depth-annotated flat list — each node followed by its subtree
 * rows at increasing depth. What the navbar dropdown, the
 * category pickers, and the manage table iterate.
 */
export function flattenCategoryTree(
  categories: NoteCategoryOut[],
): CategoryRow[] {
  const rows: CategoryRow[] = [];
  const walk = (node: CategoryNode, depth: number) => {
    rows.push({
      category: node.category,
      depth,
      hasChildren: node.children.length > 0,
    });
    for (const child of node.children) {
      walk(child, depth + 1);
    }
  };
  for (const node of buildCategoryTree(categories)) {
    walk(node, 0);
  }
  return rows;
}

/**
 * Every descendant id of a category — what merge/delete target
 * pickers exclude (folding into your own subtree is a 400).
 */
export function descendantIds(
  categories: NoteCategoryOut[],
  categoryId: number,
): Set<number> {
  const children = new Map<number, number[]>();
  for (const category of categories) {
    if (category.parent_id != null) {
      const siblings = children.get(category.parent_id) ?? [];
      siblings.push(category.id);
      children.set(category.parent_id, siblings);
    }
  }
  const ids = new Set<number>();
  const stack = [categoryId];
  while (stack.length > 0) {
    const current = stack.pop() as number;
    for (const child of children.get(current) ?? []) {
      if (!ids.has(child)) {
        ids.add(child);
        stack.push(child);
      }
    }
  }
  return ids;
}

/**
 * Whether a category's path can be expressed as a `#notes-…`
 * marker — every '-' joins TWO levels, so a slug containing '-'
 * (a legacy artifact from before the nested-tree scheme)
 * re-parses to a different chain and would silently misfile any
 * note moved onto it — or onto any of its descendants, whose
 * composed path includes the bad segment. Such categories stay
 * visible/manageable on the Categories page (rename fixes the
 * slug; delete drops the row) but must not be selectable as
 * note/move/merge/parent targets.
 */
export function isMarkerSafeCategory(
  categories: NoteCategoryOut[],
  categoryId: number,
): boolean {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const seen = new Set<number>();
  let current = byId.get(categoryId);
  while (current && !seen.has(current.id)) {
    if (current.slug.includes('-')) {
      return false;
    }
    seen.add(current.id);
    current =
      current.parent_id != null ? byId.get(current.parent_id) : undefined;
  }
  return true;
}

/**
 * Display path for a category — 'Projects / World Of Bible /
 * Easter Eggs' at depth 3. Walks ancestors via the id map; a
 * missing parent just truncates the path (orphans show their own
 * name).
 */
export function categoryPathLabel(
  categories: NoteCategoryOut[],
  categoryId: number,
): string {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const names: string[] = [];
  const seen = new Set<number>();
  let current = byId.get(categoryId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current =
      current.parent_id != null ? byId.get(current.parent_id) : undefined;
  }
  return names.join(' / ');
}
