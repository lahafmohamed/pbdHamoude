import { useState, useRef, useEffect } from 'react';
import { Input } from './input';
import { Button } from './button';
import { Check, X } from 'lucide-react';

interface InlineEditProps {
  value: string | number;
  onSave: (value: string) => Promise<void>;
  type?: 'text' | 'number';
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  displayClassName?: string;
}

export function InlineEdit({
  value,
  onSave,
  type = 'text',
  placeholder = 'Click to edit',
  className = '',
  disabled = false,
  displayClassName = ''
}: InlineEditProps) {
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

  const handleSave = async () => {
    if (editValue === String(value)) {
      setIsEditing(false);
      return;
    }

    setIsLoading(true);
    try {
      await onSave(editValue);
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
    if (!disabled) {
      setIsEditing(true);
    }
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
      className={`cursor-pointer hover:bg-muted/50 px-2 py-1 rounded transition-colors ${displayClassName} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      {value || <span className="text-muted-foreground">{placeholder}</span>}
    </div>
  );
}
