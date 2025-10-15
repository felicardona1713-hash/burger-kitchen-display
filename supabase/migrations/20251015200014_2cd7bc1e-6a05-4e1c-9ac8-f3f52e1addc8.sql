-- Add order_number column to orders table with auto-incrementing sequence
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;

ALTER TABLE orders 
ADD COLUMN order_number INTEGER DEFAULT nextval('order_number_seq');

-- Make order_number NOT NULL for new records
ALTER TABLE orders 
ALTER COLUMN order_number SET NOT NULL;

-- Update existing orders with sequential numbers
UPDATE orders 
SET order_number = nextval('order_number_seq')
WHERE order_number IS NULL;

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);