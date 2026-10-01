/**
 * Sign-aware amount: renders the raw amount string + currency in
 * tabular numerals, red for negative / green for positive unless
 * `colored` is off. Amounts stay strings — only the sign is read.
 */
export function MoneyText({
  amount,
  currency,
  colored = true,
  className = '',
}: {
  amount: string;
  currency?: string;
  colored?: boolean;
  className?: string;
}) {
  const negative = amount.startsWith('-');
  const positive = !negative && Number(amount) !== 0;
  const tone = colored
    ? negative
      ? 'text-danger'
      : positive
        ? 'text-success'
        : 'text-muted'
    : '';
  return (
    <span className={`fin-money ${tone} ${className}`.trim()}>
      {amount}
      {currency ? ` ${currency}` : ''}
    </span>
  );
}

export default MoneyText;
