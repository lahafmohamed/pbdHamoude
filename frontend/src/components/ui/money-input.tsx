import * as React from 'react';
import { Input } from './input';

export interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: string | number;
  onChange: (raw: string) => void;
  currency?: string;
}

const NBSP = ' ';

function formatDigits(raw: string): string {
  if (!raw) return '';
  const cleaned = raw.replace(/\D/g, '');
  if (!cleaned) return '';
  return cleaned.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

function stripFormat(formatted: string): string {
  return formatted.replace(/\D/g, '');
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onChange, currency = 'FCFA', className, ...props }, ref) => {
    const display = formatDigits(String(value ?? ''));

    return (
      <div className="relative">
        <Input
          ref={ref}
          inputMode="numeric"
          autoComplete="off"
          value={display}
          onChange={(e) => onChange(stripFormat(e.target.value))}
          className={'pr-16 text-left tabular-nums tracking-wide ' + (className || '')}
          {...props}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground select-none">
          {currency}
        </span>
      </div>
    );
  }
);
MoneyInput.displayName = 'MoneyInput';
