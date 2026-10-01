"""API tests for /api/tv-arhivs/ (Stage 0 of the React rewrite):
the anonymous-GET contract (``auth=None`` on the shared NinjaAPI),
typed-param 422s, pagination shape, ordering determinism, each
filter's semantics and the dropdown option lists."""
import itertools
from datetime import date

from django.test import TestCase

from tv_archive.models import Content

_counter = itertools.count(1)


def make_content(**overrides):
    n = next(_counter)
    defaults = {
        'title_lv': f'Filma {n}',
        'title_eng': f'Film {n}',
        'type': 'movie',
        'url': f'https://www.imdb.com/title/tt{n:07d}/',
        'channel': 'ltv1_hd',
    }
    defaults.update(overrides)
    return Content.objects.create(**defaults)


class ContentsApiTests(TestCase):
    API = '/api/tv-arhivs/contents/'

    def ids(self, params=''):
        resp = self.client.get(f'{self.API}?{params}')
        self.assertEqual(resp.status_code, 200)
        return [c['id'] for c in resp.json()['contents']]

    def test_anonymous_get_is_200(self):
        """THE auth=None contract: the shared API's first public
        operation — if a ninja upgrade changes None vs NOT_SET
        handling (None = no auth, NOT_SET = inherit django_auth),
        this test is the tripwire."""
        resp = self.client.get(self.API)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['contents'], [])
        self.assertEqual(body['count'], 0)
        self.assertEqual(body['page'], 1)
        self.assertEqual(body['num_pages'], 1)
        self.assertEqual(body['channels'], [])
        self.assertEqual(body['content_ratings'], [])
        self.assertEqual(body['types'], [])

    def test_row_shape(self):
        make_content(
            description_lv='apraksts', description_eng='desc',
            image='https://img.example/x.jpg', content_rating='TV-G',
            rating_value=7.5, start_date=date(2024, 1, 2),
            ratio=0.8,
        )
        row = self.client.get(self.API).json()['contents'][0]
        self.assertEqual(row['start_date'], '2024-01-02')
        self.assertEqual(row['rating_value'], 7.5)
        self.assertEqual(row['ratio'], 0.8)
        self.assertEqual(row['channel'], 'ltv1_hd')
        self.assertEqual(row['description_lv'], 'apraksts')

    def test_garbage_params_are_422(self):
        """Typed params fix the template view's junk-input 500s."""
        for params in (
            'rating_value=abc', 'ratio=x', 'start_date=not-a-date',
            'end_date=nope', 'page=abc',
        ):
            resp = self.client.get(f'{self.API}?{params}')
            self.assertEqual(resp.status_code, 422, params)
            self.assertEqual(
                resp.json()['error'], 'validation_error'
            )

    def test_pagination_shape(self):
        for _ in range(55):
            make_content()
        resp = self.client.get(self.API)
        body = resp.json()
        self.assertEqual(len(body['contents']), 50)
        self.assertEqual(body['count'], 55)
        self.assertEqual(body['num_pages'], 2)
        self.assertEqual(body['page'], 1)

        body = self.client.get(f'{self.API}?page=2').json()
        self.assertEqual(len(body['contents']), 5)
        self.assertEqual(body['page'], 2)

        # Out-of-range clamps to the last page (get_page, as in
        # finance's transactions endpoint).
        body = self.client.get(f'{self.API}?page=99').json()
        self.assertEqual(body['page'], 2)

    def test_ordering_is_start_date_desc_then_id_desc(self):
        old = make_content(start_date=date(2024, 1, 1))
        a = make_content(start_date=date(2024, 2, 1))
        b = make_content(start_date=date(2024, 2, 1))
        self.assertEqual(self.ids(), [b.pk, a.pk, old.pk])

    def test_channel_filters(self):
        a = make_content(channel='ltv1_hd')
        b = make_content(channel='ltv7_hd')
        self.assertEqual(self.ids('channel=ltv1_hd'), [a.pk])
        self.assertEqual(self.ids('not_channel=ltv1_hd'), [b.pk])

    def test_content_rating_filters(self):
        a = make_content(content_rating='TV-G')
        b = make_content(content_rating='TV-MA')
        self.assertEqual(self.ids('content_rating=TV-G'), [a.pk])
        self.assertEqual(
            self.ids('not_content_rating=TV-G'), [b.pk]
        )

    def test_rating_value_is_minimum(self):
        make_content(rating_value=5.0)
        high = make_content(rating_value=8.0)
        self.assertEqual(self.ids('rating_value=7'), [high.pk])

    def test_date_range_both_filter_start_date(self):
        old = make_content(start_date=date(2024, 1, 1))
        mid = make_content(start_date=date(2024, 2, 1))
        new = make_content(start_date=date(2024, 3, 1))
        self.assertEqual(
            self.ids('start_date=2024-02-01'), [new.pk, mid.pk]
        )
        # end_date filters start_date too — the template quirk,
        # kept verbatim ("date range on the air date").
        self.assertEqual(
            self.ids('end_date=2024-02-01'), [mid.pk, old.pk]
        )
        self.assertEqual(
            self.ids('start_date=2024-01-15&end_date=2024-02-15'),
            [mid.pk],
        )

    def test_ratio_is_minimum_not_exact(self):
        make_content(ratio=0.4)
        high = make_content(ratio=0.9)
        # Deliberate change from the template's exact float match.
        self.assertEqual(self.ids('ratio=0.5'), [high.pk])
        self.assertEqual(self.ids('ratio=0.9'), [high.pk])

    def test_option_lists_are_distinct_and_non_empty(self):
        make_content(channel='ltv7_hd', content_rating='TV-MA',
                     type='series')
        make_content(channel='ltv1_hd', content_rating='',
                     type='movie')
        make_content(channel='ltv1_hd', content_rating=None,
                     type='movie')
        body = self.client.get(self.API).json()
        self.assertEqual(body['channels'], ['ltv1_hd', 'ltv7_hd'])
        self.assertEqual(body['content_ratings'], ['TV-MA'])
        self.assertEqual(body['types'], ['movie', 'series'])
