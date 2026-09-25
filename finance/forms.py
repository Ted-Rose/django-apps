from django import forms

from finance.models import (
    Account,
    Category,
    CategoryRule,
    TransactionLimit,
)


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


class CategoryRuleForm(forms.ModelForm):
    class Meta:
        model = CategoryRule
        fields = [
            'category', 'priority', 'sender_receiver_pattern',
            'description_pattern', 'match_type', 'operator',
            'is_active',
        ]

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        if user is not None:
            self.fields['category'].queryset = Category.objects.filter(
                user=user
            )

    def clean(self):
        cleaned = super().clean()
        if not (
            cleaned.get('sender_receiver_pattern')
            or cleaned.get('description_pattern')
        ):
            raise forms.ValidationError(
                'Set at least one pattern to match on.'
            )
        return cleaned


class TransactionLimitForm(forms.ModelForm):
    class Meta:
        model = TransactionLimit
        fields = [
            'account', 'category', 'limit_7_days', 'limit_30_days',
            'is_active',
        ]

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['category'].empty_label = 'All categories'
        if user is not None:
            self.fields['account'].queryset = (
                Account.objects.for_user(user)
            )
            self.fields['category'].queryset = Category.objects.filter(
                user=user
            )
        for name, field in self.fields.items():
            if isinstance(field.widget, forms.CheckboxInput):
                field.widget.attrs['class'] = 'form-check-input'
            else:
                field.widget.attrs['class'] = 'form-control'
