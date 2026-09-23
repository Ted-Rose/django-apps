from django import forms

from finance.models import Account, TransactionLimit


class RequisitionForm(forms.Form):
    country = forms.CharField(
        max_length=2,
        initial='lv',
        help_text='Two-letter country code (e.g. lv, gb, de)'
    )
    institution_id = forms.CharField(max_length=100)


class ShareAccountForm(forms.Form):
    username = forms.CharField(
        max_length=150,
        help_text='Username of the user to share this account with'
    )


class TransactionLimitForm(forms.ModelForm):
    class Meta:
        model = TransactionLimit
        fields = [
            'account', 'limit_7_days', 'limit_30_days', 'is_active',
        ]

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        if user is not None:
            self.fields['account'].queryset = (
                Account.objects.for_user(user)
            )
        for name, field in self.fields.items():
            if isinstance(field.widget, forms.CheckboxInput):
                field.widget.attrs['class'] = 'form-check-input'
            else:
                field.widget.attrs['class'] = 'form-control'
