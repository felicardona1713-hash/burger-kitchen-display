-- Remove the 'total' column from orders table since we only need 'monto'
ALTER TABLE orders DROP COLUMN IF EXISTS total;