"""notes_doc (TipTap doc-JSON) coverage — the doc→markdown
projection, the create/update payload resolution in views.py,
body_doc handling in notes_api.py, and the pull-side reconcile
in _write_remote_tasks (remote text edits clear the mirror).
"""
import json
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from google_tasks.models import GoogleTask, GoogleTaskList, NoteCategory
from google_tasks.services import sync_tasks
from google_tasks.tiptap_doc import doc_to_markdown, is_tiptap_doc


def doc(*blocks):
    return json.dumps({'type': 'doc', 'content': list(blocks)})


def para(*runs, marks=None):
    return {
        'type': 'paragraph',
        'content': [
            {'type': 'text', 'text': text, **({'marks': m} if m else {})}
            for text, m in runs
        ],
    }


def text_run(text, *mark_types):
    marks = [{'type': t} for t in mark_types]
    return (text, marks or None)


class TiptapDocUnitTests(TestCase):

    def test_is_tiptap_doc(self):
        self.assertTrue(is_tiptap_doc(doc(para())))
        self.assertFalse(is_tiptap_doc('plain text'))
        self.assertFalse(is_tiptap_doc('{"type": "paragraph"}'))
        self.assertFalse(is_tiptap_doc(None))

    def test_paragraphs_and_headings(self):
        md = doc_to_markdown(doc(
            {'type': 'heading', 'attrs': {'level': 2},
             'content': [{'type': 'text', 'text': 'Title'}]},
            para(text_run('body text')),
        ))
        self.assertEqual(md, '## Title\n\nbody text')

    def test_inline_marks(self):
        md = doc_to_markdown(doc(para(
            text_run('a '), text_run('b', 'bold'), text_run(' '),
            text_run('i', 'italic'), text_run(' '),
            text_run('s', 'strike'), text_run(' '),
            text_run('c', 'code'), text_run(' '),
            text_run('u', 'underline'),
        )))
        self.assertEqual(md, 'a **b** *i* ~~s~~ `c` u')

    def test_link_mark(self):
        md = doc_to_markdown(doc(para(
            ('see ', None),
            ('docs', [{'type': 'link',
                       'attrs': {'href': 'https://x.io'}}]),
        )))
        self.assertEqual(md, 'see [docs](https://x.io)')

    def test_lists_and_nesting(self):
        md = doc_to_markdown(doc(
            {'type': 'orderedList', 'attrs': {'start': 3},
             'content': [
                 {'type': 'listItem', 'content': [
                     para(text_run('first')),
                     {'type': 'bulletList', 'content': [
                         {'type': 'listItem', 'content': [
                             para(text_run('nested')),
                         ]},
                     ]},
                 ]},
                 {'type': 'listItem', 'content': [
                     para(text_run('second')),
                 ]},
             ]},
        ))
        self.assertEqual(
            md, '3. first\n\n   - nested\n4. second'
        )

    def test_quote_code_rule(self):
        md = doc_to_markdown(doc(
            {'type': 'blockquote', 'content': [para(text_run('q'))]},
            {'type': 'codeBlock', 'attrs': {'language': 'py'},
             'content': [{'type': 'text', 'text': 'x = 1'}]},
            {'type': 'horizontalRule'},
        ))
        self.assertEqual(md, '> q\n\n```py\nx = 1\n```\n\n---')

    def test_leading_block_chars_get_escaped(self):
        md = doc_to_markdown(doc(para(text_run('- not a list'))))
        self.assertEqual(md, '\\- not a list')
        # A paragraph that looks like a heading escapes too —
        # bare '#tag' (no space) correctly stays literal.
        md2 = doc_to_markdown(doc(
            para(text_run('# looks like a heading')),
            para(text_run('#tag')),
        ))
        self.assertEqual(
            md2, '\\# looks like a heading\n\n#tag'
        )

    def test_invalid_and_empty(self):
        self.assertEqual(doc_to_markdown('not json'), '')
        self.assertEqual(doc_to_markdown('{"type":"doc"}'), '')


class NotesDocApiTests(TestCase):

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.client.force_login(self.user)
        self.task_list = GoogleTaskList.objects.create(
            user=self.user, list_id='list-1', title='List 1'
        )

    def make_task(self, task_id, **kwargs):
        return GoogleTask.objects.create(
            user=self.user, task_id=task_id,
            task_list=self.task_list, title=task_id, **kwargs,
        )

    def post_json(self, path, payload):
        return self.client.post(
            f'/api/tasks{path}', data=json.dumps(payload),
            content_type='application/json',
        )

    def patch_json(self, path, payload):
        return self.client.patch(
            f'/api/notes{path}', data=json.dumps(payload),
            content_type='application/json',
        )

    # --- update_task_view ---

    def test_update_with_notes_doc_derives_markdown(self):
        task = self.make_task('t1')
        rich = doc({'type': 'heading', 'attrs': {'level': 1},
                    'content': [{'type': 'text', 'text': 'Big'}]},
                   para(text_run('note ', ),
                        text_run('bold', 'bold')))
        resp = self.post_json(f'/task/{task.task_id}/update/', {
            'title': 't1', 'notes_doc': rich,
        })
        self.assertEqual(resp.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.notes, '# Big\n\nnote **bold**')
        self.assertEqual(task.notes_doc, rich)
        self.assertTrue(task.needs_push)

    def test_update_rejects_invalid_notes_doc(self):
        task = self.make_task('t1')
        resp = self.post_json(f'/task/{task.task_id}/update/', {
            'title': 't1', 'notes_doc': '{"type":"nope"}',
        })
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['code'], 'invalidNotesDoc')

    def test_plain_notes_change_clears_doc(self):
        task = self.make_task('t1', notes='old',
                              notes_doc=doc(para(text_run('old'))))
        resp = self.post_json(f'/task/{task.task_id}/update/', {
            'title': 't1', 'notes': 'new body',
        })
        self.assertEqual(resp.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.notes, 'new body')
        self.assertIsNone(task.notes_doc)

    def test_unchanged_notes_keep_doc(self):
        rich = doc(para(text_run('same')))
        task = self.make_task('t1', notes='same', notes_doc=rich)
        resp = self.post_json(f'/task/{task.task_id}/update/', {
            'title': 'renamed', 'notes': 'same',
        })
        self.assertEqual(resp.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.notes_doc, rich)

    # --- notes create/patch with body_doc ---

    def test_create_note_with_body_doc(self):
        category = NoteCategory.objects.create(
            user=self.user, slug='god', name='God'
        )
        rich = doc(para(text_run('pray ', ),
                        text_run('daily', 'italic')))
        with patch('google_tasks.views.get_creds_dict',
                   return_value={'token': 't'}), \
                patch('google_tasks.views.create_task',
                      return_value={
                          'id': 'remote-1',
                          'title': 'n',
                          'status': 'needsAction',
                          'notes': 'pray *daily*\n\n#notes-god',
                      }):
            resp = self.client.post(
                '/api/notes/',
                data=json.dumps({
                    'title': 'n', 'body_doc': rich,
                    'category_id': category.id,
                }),
                content_type='application/json',
            )
        self.assertEqual(resp.status_code, 200)
        task = GoogleTask.objects.get(task_id='remote-1')
        self.assertEqual(task.notes_doc, rich)
        self.assertIn('#notes-god', task.notes)

    def test_patch_note_with_body_doc(self):
        note = self.make_task(
            'n1', is_note=True, notes='old\n\n#notes',
        )
        rich = doc(para(text_run('fresh ', ),
                        text_run('body', 'bold')))
        resp = self.patch_json('/n1/', {
            'title': 'n1', 'body_doc': rich,
        })
        self.assertEqual(resp.status_code, 200)
        note.refresh_from_db()
        self.assertEqual(note.notes_doc, rich)
        self.assertEqual(
            note.notes, 'fresh **body**\n\n#notes'
        )

    def test_patch_note_plain_body_clears_doc(self):
        note = self.make_task(
            'n1', is_note=True,
            notes='old\n\n#notes',
            notes_doc=doc(para(text_run('old'))),
        )
        resp = self.patch_json('/n1/', {
            'title': 'n1', 'body': 'plain new',
        })
        self.assertEqual(resp.status_code, 200)
        note.refresh_from_db()
        self.assertIsNone(note.notes_doc)
        self.assertEqual(note.notes, 'plain new\n\n#notes')


class NotesDocSyncTests(TestCase):
    """_write_remote_tasks reconciliation: the rich mirror is only
    valid while the synced text matches — remote body edits clear
    it, identical remote text keeps it."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username='alice', password='pw'
        )
        self.task_list = GoogleTaskList.objects.create(
            user=self.user, list_id='list-1', title='List 1'
        )

    def remote_item(self, task_id, title, **fields):
        item = {
            'id': task_id, 'title': title,
            'status': 'needsAction',
            'updated': '2026-10-10T03:00:00Z',
        }
        item.update(fields)
        return item

    def run_sync(self, items):
        service = MagicMock()
        request = MagicMock()
        request.execute.return_value = {'items': items}
        service.tasks.return_value.list.return_value = request
        with patch(
            'google_tasks.services.push_local_changes',
            return_value={}
        ), patch(
            'google_tasks.services.get_tasks_service',
            return_value=service
        ):
            return sync_tasks(self.user, creds={})

    def test_matching_remote_notes_keep_doc(self):
        rich = doc(para(text_run('synced **body**')))
        task = GoogleTask.objects.create(
            user=self.user, task_id='t1', task_list=self.task_list,
            title='t', notes='synced **body**', notes_doc=rich,
        )
        self.assertTrue(self.run_sync([
            self.remote_item('t1', 't', notes='synced **body**'),
        ]))
        task.refresh_from_db()
        self.assertEqual(task.notes_doc, rich)

    def test_changed_remote_notes_clear_doc(self):
        task = GoogleTask.objects.create(
            user=self.user, task_id='t1', task_list=self.task_list,
            title='t', notes='old', notes_doc=doc(para(text_run('old'))),
        )
        self.assertTrue(self.run_sync([
            self.remote_item('t1', 't', notes='rewrote in google'),
        ]))
        task.refresh_from_db()
        self.assertEqual(task.notes, 'rewrote in google')
        self.assertIsNone(task.notes_doc)
