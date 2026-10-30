"""TipTap doc-JSON ↔ markdown helpers for GoogleTask.notes_doc.

`task.notes` stays the canonical synced field — Google Tasks
stores plain text only, and users hand-write markdown there, so
the rich editor's doc-JSON lives in the local-only `notes_doc`
column while `notes` carries its markdown projection. These
helpers validate doc-JSON and serialize it back to markdown.

Stored docs are user-controlled JSON — the walk caps depth and
node count so a crafted doc can't exhaust the stack.
"""
import json
import re

MAX_WALK_DEPTH = 64
MAX_WALK_NODES = 5000


def is_tiptap_doc(value):
    """True when `value` parses as a serialized TipTap doc
    (JSON object with type 'doc' and a content array)."""
    if not isinstance(value, str):
        return False
    try:
        parsed = json.loads(value)
    except (ValueError, TypeError):
        return False
    return (
        isinstance(parsed, dict)
        and parsed.get('type') == 'doc'
        and isinstance(parsed.get('content'), list)
    )


def _attrs(node):
    attrs = node.get('attrs')
    return attrs if isinstance(attrs, dict) else {}


def _mark_types(node):
    marks = node.get('marks')
    if not isinstance(marks, list):
        return []
    return [
        m.get('type') for m in marks
        if isinstance(m, dict) and m.get('type')
    ]


def _escape_leading(line):
    """A paragraph line that would reparse as a markdown block
    gets a backslash before the marker so the projection stays
    a paragraph on the markdown -> doc round-trip."""
    if _LEADING_BLOCK_RE.match(line):
        return '\\' + line
    return line


_LEADING_BLOCK_RE = re.compile(
    r'(?:#{1,6}[ \t]|>[ \t]?|[-*+•◦▪][ \t]|\d{1,9}[.)][ \t]'
    r'|```|~~~|(?:[-*_][ \t]*){3,}$)'
)


def _inline(node, depth, remaining):
    """Serialize one inline node to markdown."""
    if remaining['count'] <= 0 or depth > MAX_WALK_DEPTH:
        return ''
    remaining['count'] -= 1
    node_type = node.get('type')
    if node_type == 'hardBreak':
        return '\n'
    if node_type != 'text':
        return _children_text(node, depth + 1, remaining)
    text = node.get('text')
    if not isinstance(text, str):
        return ''
    marks = _mark_types(node)
    if 'code' in marks:
        # Code spans render verbatim — the other marks can't
        # nest inside one in markdown anyway.
        return f'`{text}`'
    if 'bold' in marks:
        text = f'**{text}**'
    if 'italic' in marks:
        text = f'*{text}*'
    if 'strike' in marks:
        text = f'~~{text}~~'
    for mark in node.get('marks') or []:
        if isinstance(mark, dict) and mark.get('type') == 'link':
            href = _attrs(mark).get('href')
            if href and not any(c.isspace() for c in str(href)):
                text = f'[{text}]({href})'
            break
    # underline has no markdown syntax — text passes through.
    return text


def _children_text(node, depth, remaining):
    children = node.get('content')
    if not isinstance(children, list):
        return ''
    return ''.join(
        _inline(child, depth, remaining)
        if child.get('type') in ('text', 'hardBreak')
        else _block(child, depth, remaining)
        for child in children
        if isinstance(child, dict)
    )


def _list_item_body(node, depth, remaining):
    """listItem children serialized as one markdown chunk:
    first block flows after the marker, the rest are indented
    continuation lines (nested lists end up one level deeper)."""
    parts = [
        _block(child, depth, remaining)
        for child in node.get('content') or []
        if isinstance(child, dict)
    ]
    return '\n\n'.join(part for part in parts if part)


def _block(node, depth, remaining):
    """Serialize one block node to a markdown chunk (blocks are
    joined by the caller)."""
    if remaining['count'] <= 0 or depth > MAX_WALK_DEPTH:
        return ''
    remaining['count'] -= 1
    node_type = node.get('type')
    inner = lambda n: _children_text(n, depth + 1, remaining)
    if node_type == 'doc':
        parts = [
            _block(child, depth + 1, remaining)
            for child in node.get('content') or []
            if isinstance(child, dict)
        ]
        return '\n\n'.join(part for part in parts if part)
    if node_type == 'paragraph':
        return '\n'.join(
            _escape_leading(line)
            for line in inner(node).split('\n')
        )
    if node_type == 'heading':
        level = _attrs(node).get('level')
        level = level if isinstance(level, int) and \
            1 <= level <= 6 else 1
        return '#' * level + ' ' + inner(node)
    if node_type == 'blockquote':
        quoted = '\n\n'.join(
            _block(child, depth + 1, remaining)
            for child in node.get('content') or []
            if isinstance(child, dict)
        )
        return '\n'.join(
            '> ' + line if line else '>'
            for line in quoted.split('\n')
        )
    if node_type == 'codeBlock':
        language = _attrs(node).get('language') or ''
        body = inner(node)
        return f'```{language}\n{body}\n```'
    if node_type == 'horizontalRule':
        return '---'
    if node_type == 'bulletList':
        return _list(node, depth, remaining, ordered=False)
    if node_type == 'orderedList':
        return _list(node, depth, remaining, ordered=True)
    if node_type == 'listItem':
        return _list_item_body(node, depth + 1, remaining)
    # Unknown block — emit its text content rather than dropping.
    return inner(node)


def _list(node, depth, remaining, ordered):
    start = _attrs(node).get('start')
    start = start if isinstance(start, int) and start > 0 else 1
    lines = []
    for i, child in enumerate(node.get('content') or []):
        if not isinstance(child, dict):
            continue
        marker = f'{start + i}. ' if ordered else '- '
        body = _block(child, depth + 1, remaining)
        body_lines = body.split('\n') if body else ['']
        # Continuation lines (incl. nested lists) indent by the
        # marker width so the markdown reparse keeps the depth.
        item = [marker + body_lines[0]]
        item.extend(
            (' ' * len(marker)) + line if line else ''
            for line in body_lines[1:]
        )
        lines.append('\n'.join(item))
    return '\n'.join(lines)


def doc_to_markdown(doc_json):
    """Serialize a TipTap doc-JSON string to markdown. Returns ''
    for empty/invalid docs."""
    try:
        doc = json.loads(doc_json)
    except (ValueError, TypeError):
        return ''
    if not isinstance(doc, dict):
        return ''
    remaining = {'count': MAX_WALK_NODES}
    content = [
        _block(child, 0, remaining)
        for child in doc.get('content') or []
        if isinstance(child, dict)
    ]
    return '\n\n'.join(chunk for chunk in content if chunk)
