import re


def esv_passages_to_json(passages):
    verses = re.findall(r'\[(\d+)\] (.*?)\s*(?=\[\d+\]|$)', passages)
    parsed_passages = [{'verse': int(verse[0]), 'text': verse[1]} for verse in verses]

    return parsed_passages
