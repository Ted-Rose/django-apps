from django.core.management.base import BaseCommand

from tv_archive.scraper import fetch_tv_program_details


class Command(BaseCommand):
    help = (
        'Scrape tet.lv TV schedules and enrich them with IMDb '
        'ratings. Uses googletrans (unofficial API — may break '
        'without code changes). A full run takes minutes to hours: '
        '1-2s sleep per program across 14 days x 3 channels.'
    )

    def handle(self, *args, **options):
        fetch_tv_program_details()
