from django import forms
import json
import os
from django.conf import settings

class PassageForm(forms.Form):
    # Load Bible data
    try:
        bible_data_path = os.path.join(
            settings.BASE_DIR,
            'bible_research/esv_bible_chapters.json'
        )
        with open(bible_data_path, 'r') as f:
            bible_data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        bible_data = {}
    
    # Create choices for book dropdown
    book_choices = [('', 'Select a book')] + [(book, book) for book in bible_data.keys()]
    
    book = forms.ChoiceField(
        choices=book_choices,
        required=True,
        widget=forms.Select(attrs={'class': 'form-control', 'id': 'book'})
    )
    
    chapter = forms.ChoiceField(
        choices=[('', 'Select a chapter')],  # Empty initially
        required=True,
        widget=forms.Select(attrs={'class': 'form-control', 'id': 'chapter', 'disabled': 'disabled'})
    )
    
    verse = forms.ChoiceField(
        choices=[('', 'Select a verse')],  # Empty initially
        required=True,
        widget=forms.Select(attrs={'class': 'form-control', 'id': 'verse', 'disabled': 'disabled'})
    )
    
    # Keep the original passage field for backward compatibility or as a hidden field
    passage = forms.CharField(
        required=False,
        widget=forms.HiddenInput(),  # Make it hidden
    )
    
    # Add the Bible data as a form attribute to access it in the template
    bible_data_json = json.dumps(bible_data)