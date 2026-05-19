import { ReactNode, useRef } from 'react';

interface FormProps {
  children: ReactNode;
  onSubmit?: (e: React.FormEvent) => void;
  className?: string;
  enterKeySubmit?: boolean;
}

export function Form({ children, onSubmit, className = '', enterKeySubmit = true }: FormProps) {
  const formRef = useRef<HTMLFormElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && enterKeySubmit) {
      const target = e.target as HTMLElement;
      
      // Don't submit if in textarea or if modifier keys are pressed
      if (target.tagName === 'TEXTAREA' || e.shiftKey || e.ctrlKey || e.metaKey) {
        return;
      }

      // Check if we're in an input field
      if (target.tagName === 'INPUT') {
        const form = formRef.current;
        if (form && onSubmit) {
          e.preventDefault();
          const syntheticEvent = new Event('submit', { bubbles: true, cancelable: true }) as any;
          syntheticEvent.preventDefault = () => {};
          onSubmit(syntheticEvent);
        }
      }
    }
  };

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className={className}
      onKeyDown={handleKeyDown}
    >
      {children}
    </form>
  );
}

// Enhanced input with better Enter key handling
interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  onSubmit?: () => void;
}

export function FormInput({ onSubmit, ...props }: FormInputProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
    
    // Call original onKeyDown if provided
    if (props.onKeyDown) {
      props.onKeyDown(e);
    }
  };

  return (
    <input
      {...props}
      onKeyDown={handleKeyDown}
    />
  );
}
