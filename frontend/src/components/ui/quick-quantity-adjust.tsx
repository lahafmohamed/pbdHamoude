import { useState } from 'react';
import { Button } from './button';
import { Input } from './input';
import { Plus, Minus, Package } from 'lucide-react';

interface QuickQuantityAdjustProps {
  currentStock: number;
  onAdjust: (delta: number) => Promise<void>;
  disabled?: boolean;
  size?: 'sm' | 'md';
  showStockLevel?: boolean;
}

export function QuickQuantityAdjust({
  currentStock,
  onAdjust,
  disabled = false,
  size = 'sm',
  showStockLevel = true
}: QuickQuantityAdjustProps) {
  const [quantity, setQuantity] = useState('1');
  const [isAdjusting, setIsAdjusting] = useState(false);

  const handleAdjust = async (delta: number) => {
    if (disabled || isAdjusting) return;
    
    const qty = parseInt(quantity) || 1;
    const finalDelta = delta * qty;
    
    // Prevent negative stock for subtraction
    if (finalDelta < 0 && currentStock + finalDelta < 0) {
      return;
    }

    setIsAdjusting(true);
    try {
      await onAdjust(finalDelta);
      setQuantity('1'); // Reset to 1 after successful adjustment
    } catch (error) {
      console.error('Failed to adjust stock:', error);
    } finally {
      setIsAdjusting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdjust(1); // Add by default on Enter
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      handleAdjust(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      handleAdjust(-1);
    }
  };

  const canSubtract = currentStock > 0;
  const inputSize = size === 'sm' ? 'w-14 h-7' : 'w-16 h-8';
  const buttonSize = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';

  return (
    <div className="flex items-center gap-1">
      {/* Quick subtract buttons */}
      <div className="flex items-center gap-0">
        <Button
          variant="outline"
          size="sm"
          className={`${buttonSize} p-0 rounded-r-none border-r-0`}
          onClick={() => handleAdjust(-1)}
          disabled={disabled || isAdjusting || !canSubtract}
          title="Retirer 1"
        >
          <Minus className="h-3 w-3" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={`${buttonSize} p-0 rounded-l-none`}
          onClick={() => handleAdjust(-10)}
          disabled={disabled || isAdjusting || !canSubtract || currentStock < 10}
          title="Retirer 10"
        >
          <span className="text-xs font-bold">−10</span>
        </Button>
      </div>

      {/* Quantity input */}
      <Input
        type="number"
        min="1"
        max={currentStock}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled || isAdjusting}
        className={`${inputSize} text-center border-x-0`}
        placeholder="0"
      />

      {/* Quick add buttons */}
      <div className="flex items-center gap-0">
        <Button
          variant="outline"
          size="sm"
          className={`${buttonSize} p-0 rounded-r-none border-r-0`}
          onClick={() => handleAdjust(1)}
          disabled={disabled || isAdjusting}
          title="Ajouter 1"
        >
          <Plus className="h-3 w-3" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={`${buttonSize} p-0 rounded-l-none`}
          onClick={() => handleAdjust(10)}
          disabled={disabled || isAdjusting}
          title="Ajouter 10"
        >
          <span className="text-xs font-bold">+10</span>
        </Button>
      </div>

      {/* Stock level indicator */}
      {showStockLevel && (
        <div className="flex items-center gap-1 ml-2">
          <Package className="h-3 w-3 text-muted-foreground" />
          <span className={`text-xs font-medium ${
            currentStock <= 5 ? 'text-red-600' : 
            currentStock <= 20 ? 'text-yellow-600' : 
            'text-green-600'
          }`}>
            {currentStock}
          </span>
        </div>
      )}

      {/* Loading indicator */}
      {isAdjusting && (
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      )}
    </div>
  );
}
