import { useState, useRef, useEffect } from 'react';
import { Input } from './input';
import { Button } from './button';
import { Check, X } from 'lucide-react';

interface QuickInputProps {
  value: string | number;
  onSave: (value: string) => Promise<void>;
  type?: 'text' | 'number';
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  selectOnFocus?: boolean;
  clearOnSave?: boolean;
}

export function QuickInput({
  value,
  onSave,
  type = 'text',
  placeholder = 'Enter value',
  className = '',
  autoFocus = false,
  selectOnFocus = true,
  clearOnSave = false
}: QuickInputProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value));
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(String(value));
  }, [value]);

  useEffect(() => {
    if (isEditing && autoFocus && inputRef.current) {
      inputRef.current.focus();
      if (selectOnFocus) {
        inputRef.current.select();
      }
    }
  }, [isEditing, autoFocus, selectOnFocus]);

  const handleSave = async () => {
    if (editValue === String(value) && !clearOnSave) {
      setIsEditing(false);
      return;
    }

    setIsLoading(true);
    try {
      await onSave(editValue);
      if (clearOnSave) {
        setEditValue('');
      }
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save:', error);
      setEditValue(String(value));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setEditValue(String(value));
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  const handleClick = () => {
    setIsEditing(true);
  };

  if (isEditing) {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <Input
          ref={inputRef}
          type={type}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          className="h-8 text-xs"
          placeholder={placeholder}
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isLoading}
          className="h-8 w-8 p-0 text-green-600 hover:text-green-700"
        >
          <Check className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleCancel}
          disabled={isLoading}
          className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div
      onClick={handleClick}
      className={`cursor-pointer hover:bg-muted/50 px-2 py-1 rounded transition-colors ${className}`}
    >
      {value || <span className="text-muted-foreground">{placeholder}</span>}
    </div>
  );
}

// Specialized quick input for quantity with preset buttons
export function QuickQuantityInput({
  value,
  onSave,
  max,
  min = 0,
  className = ''
}: {
  value: number;
  onSave: (value: number) => Promise<void>;
  max?: number;
  min?: number;
  className?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value));
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(String(value));
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = async (newValue: number) => {
    if (newValue === value) {
      setIsEditing(false);
      return;
    }

    if (newValue < min || (max && newValue > max)) {
      return;
    }

    setIsLoading(true);
    try {
      await onSave(newValue);
      setEditValue(String(newValue));
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save:', error);
      setEditValue(String(value));
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickAdd = (amount: number) => {
    const newValue = value + amount;
    if (newValue >= min && (!max || newValue <= max)) {
      handleSave(newValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const newValue = parseInt(editValue) || 0;
      handleSave(newValue);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsEditing(false);
      setEditValue(String(value));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      handleQuickAdd(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      handleQuickAdd(-1);
    }
  };

  if (isEditing) {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleQuickAdd(-1)}
          disabled={isLoading || value <= min}
          className="h-8 w-8 p-0"
        >
          −
        </Button>
        <Input
          ref={inputRef}
          type="number"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          className="h-8 w-16 text-center"
          min={min}
          max={max}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleQuickAdd(1)}
          disabled={isLoading || !!(max && value >= max)}
          className="h-8 w-8 p-0"
        >
          +
        </Button>
        <Button
          size="sm"
          onClick={() => handleSave(parseInt(editValue) || 0)}
          disabled={isLoading}
          className="h-8 w-8 p-0 text-green-600 hover:text-green-700"
        >
          <Check className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setIsEditing(false);
            setEditValue(String(value));
          }}
          disabled={isLoading}
          className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div
      onClick={() => setIsEditing(true)}
      className={`cursor-pointer hover:bg-muted/50 px-2 py-1 rounded transition-colors flex items-center gap-2 ${className}`}
    >
      <span className="font-medium">{value}</span>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            handleQuickAdd(1);
          }}
          disabled={!!(max && value >= max)}
          className="h-6 w-6 p-0"
        >
          +
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            handleQuickAdd(-1);
          }}
          disabled={value <= min}
          className="h-6 w-6 p-0"
        >
          −
        </Button>
      </div>
    </div>
  );
}
