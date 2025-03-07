from django import forms


class PassageForm(forms.Form):
    passage = forms.CharField(label='Enter Bible Passage', max_length=100)
