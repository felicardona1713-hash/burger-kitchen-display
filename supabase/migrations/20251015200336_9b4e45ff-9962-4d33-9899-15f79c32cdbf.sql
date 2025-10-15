-- Drop the existing sequence since we'll use a date-based counter
DROP SEQUENCE IF EXISTS order_number_seq CASCADE;

-- Create a function to get the next order number for today
CREATE OR REPLACE FUNCTION get_daily_order_number()
RETURNS INTEGER AS $$
DECLARE
  next_number INTEGER;
BEGIN
  -- Get the count of orders created today and add 1
  SELECT COALESCE(COUNT(*), 0) + 1 INTO next_number
  FROM orders
  WHERE DATE(created_at) = CURRENT_DATE;
  
  RETURN next_number;
END;
$$ LANGUAGE plpgsql;

-- Update the default value for order_number to use the new function
ALTER TABLE orders 
ALTER COLUMN order_number SET DEFAULT get_daily_order_number();

-- Create a trigger function to set order number before insert
CREATE OR REPLACE FUNCTION set_daily_order_number()
RETURNS TRIGGER AS $$
BEGIN
  -- Only set if not already provided
  IF NEW.order_number IS NULL THEN
    NEW.order_number := get_daily_order_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trigger_set_daily_order_number ON orders;

-- Create trigger to automatically set order number on insert
CREATE TRIGGER trigger_set_daily_order_number
BEFORE INSERT ON orders
FOR EACH ROW
EXECUTE FUNCTION set_daily_order_number();