"""Currency-aware money formatting shared by alert commands."""

CURRENCY_SYMBOLS = {'EUR': '€', 'USD': '$', 'GBP': '£'}


def fmt_money(amount, currency):
    symbol = CURRENCY_SYMBOLS.get(currency)
    if symbol:
        return f'{symbol}{amount:.2f}'
    return f'{amount:.2f} {currency}'
