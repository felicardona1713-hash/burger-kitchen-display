-- Remove pedido column since we'll work only with items
ALTER TABLE public.orders DROP COLUMN IF EXISTS pedido;

-- Add comment to items column explaining the structure
COMMENT ON COLUMN public.orders.items IS 'Structured array of order items with detailed metrics: burger_type, quantity, patty_size (simple/doble/triple), combo (boolean), additions (array), removals (array)';