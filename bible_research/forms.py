from django import forms


class PassageForm(forms.Form):
    passage = forms.CharField(
        label='Enter Bible Passage',
        max_length=100,
        widget=forms.TextInput(attrs={'placeholder': 'e.g., Job 3 or Job 3:1-7'}),
    )
