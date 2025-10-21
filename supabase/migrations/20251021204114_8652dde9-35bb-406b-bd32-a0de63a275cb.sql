-- Add payment method column to orders table
ALTER TABLE orders 
ADD COLUMN metodo_pago TEXT DEFAULT 'efectivo';