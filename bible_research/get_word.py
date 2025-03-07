import requests
import os
import json
from time import sleep
from django.conf import settings


def get_verses(passage, format='text'):
    url = f'https://api.esv.org/v3/passage/{format}/'
    params = {
        'q': passage,
        'include-headings': False,
        'include-footnotes': False,
    'include-verse-numbers': True,
        'include-short-copyright': False,
        'include-passage-references': False
    }

    headers = {
        'Authorization': 'Token %s' % settings.ESV_KEY
    }

    resp = requests.get(url, params=params, headers=headers)
    if resp.status_code == 200:
        if format == 'text':
            json_resp = resp.json()
            # print("response text:\n", resp.text)
            return json_resp if json_resp['passages'] else 'Passage not found'
        elif format == 'search':
            return resp.json()
        elif format == 'audio':
            print(f"Saving '{passage}' as an audio file...")
            file_name = f"{passage.replace(' ', '_').replace(':', '-')}.mp3"
            file_path = os.path.join(os.getcwd(), file_name)
            with open(file_path, 'wb') as audio_file:
                for chunk in resp.iter_content(chunk_size=1024):
                    if chunk:
                        audio_file.write(chunk)
            print(f'Audio file saved as {file_name}')
            return file_name
        else:
            raise ValueError(f'Unsupported format: {format}')
    else:
        raise Exception(f'API resp: {resp.status_code} {resp.text}')


def search_bible(text, get_audio=False):
    format = "search"
    search_results = get_verses(text, format)
    if get_audio:
        for passage in search_results['results']:
            print("Passage:\n", passage)
            get_verses(passage['reference'], format='audio')
    return search_results


# # Search and get audios
# text = "Zeal of the Lord"
# search_results = search_bible(text, get_audio=True)
# print(search_results)


def get_bible_chapters_and_verses():
    with open('esv_bible_chapters.json', 'r') as file:
        bible = json.load(file)
    current_book_number = 1
    for book, book_info in bible.items():
        next_chapter_number = None
        current_book_number_str = str(current_book_number).zfill(3)
        print(f"\n\nNow processing {book}...")
        print(f"current_book_number_str: {current_book_number_str}")

        if 'chapters' not in book_info:
            print(f"  {book} has no chapters.")
            book_info.update({
                'book_number': current_book_number_str,
                'chapters': {
                    "001": {
                        "verse_count": "0"
                    }
                }
            })

        chapters = book_info.get('chapters', {})
        current_book_number += 1

        for _ in range(151):
            last_chapter = max(chapters.keys(), key=int)
            if next_chapter_number:
                last_chapter = next_chapter_number

            print(f"\n\nsearching for {book} {last_chapter}")
            passage = get_verses(f"{book} {last_chapter}")
            last_verse = passage['passage_meta'][0]['chapter_end'][1]
            last_verse_number = str(last_verse)[-3:].zfill(3)
            next_book = passage['passage_meta'][0]['next_chapter'][1]
            next_book_number = str(next_book)[:-6].zfill(3)
            next_chapter_number = str(next_book)[-6:][:-3].zfill(3)
            next_chapter_last_verse = str(next_book)[-3:]

            print("last_verse_number:", last_verse_number)
            print("next_book_number:", next_book_number)
            print("next_chapter_number:", next_chapter_number)
            print("next_chapter_last_verse:", next_chapter_last_verse)
            print("book[book_number] is", book_info.get('book_number', {}))

            sleep(2)

            book_info['chapters'][last_chapter] = {'verse_count': last_verse_number}
            if next_book_number == str(book_info.get('book_number', {})):
                book_info['chapters'][next_chapter_number] = {'verse_count': next_chapter_last_verse}
                print(f"Added chapter {next_chapter_number} with verse count {next_chapter_last_verse} to {book}")
                with open('esv_bible_chapters.json', 'w') as file:
                    json.dump(bible, file, indent=4)

            else:
                break


# get_bible_chapters_and_verses()

# Genesis 1:1-5
# Genesis 1:1-2:5
# Genesis 1
# Genesis 1:99 - returns last verse
print(get_verses("Genesis 1:99")['passages'])
