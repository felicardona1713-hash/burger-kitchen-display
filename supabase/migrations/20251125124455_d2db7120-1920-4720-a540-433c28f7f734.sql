-- Add cadete_salio field to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cadete_salio BOOLEAN DEFAULT false;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number, fecha);