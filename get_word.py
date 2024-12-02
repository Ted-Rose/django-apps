import requests
import os
import json

API_KEY = 'Token your_api_token'

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
        'Authorization': 'Token %s' % API_KEY
    }

    resp = requests.get(url, params=params, headers=headers)
    if resp.status_code == 200:
        if format == 'text':
            json_resp = resp.json()
            print("response text:\n", resp.text)
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
    with open('bible_chapters.json', 'r') as file:
        bible_data = json.load(file)

    for book, book_info in bible_data.items():
        print(f"Now processing {book}...")
        chapters = book_info.get('chapters', {})
        if not chapters:
            print(f"  {book} has no chapters.")
            continue  # Skip to the next book

        # Get the last chapter number (since chapters are numbered)
        last_chapter = max(chapters.keys(), key=int)
        print(f"searching for {book} {last_chapter}")
        passage = get_verses(f"{book} {last_chapter}")
        print("Chapter end:\n", passage['passage_meta'][0]['chapter_end'])
        print("Next chapter:\n", passage['passage_meta'][0]['next_chapter'])
        last_verse = passage['passage_meta'][0]['chapter_end'][1]
        next_book = passage['passage_meta'][0]['next_chapter'][0]

        last_verse_number = str(last_verse)[-3:]

        next_book_number = str(next_book)[:-6]

        # Print the results
        print("last_verse_number:", last_verse_number)
        print("next_book_number:", next_book_number)

        # Get the content of the last chapter
        last_chapter_content = chapters[str(last_chapter)]

        print(f"Last Chapter {last_chapter}: {last_chapter_content}")

        break


get_bible_chapters_and_verses()