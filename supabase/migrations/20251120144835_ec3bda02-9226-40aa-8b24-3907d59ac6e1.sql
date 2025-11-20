-- Update the get_daily_order_number function to use MAX instead of COUNT
-- This prevents number reuse even if orders are deleted
CREATE OR REPLACE FUNCTION public.get_daily_order_number()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  next_number INTEGER;
BEGIN
  -- Get the maximum order number for today and add 1
  -- If no orders exist today, start at 1
  SELECT COALESCE(MAX(order_number), 0) + 1 INTO next_number
  FROM orders
  WHERE DATE(created_at) = CURRENT_DATE;
  
  RETURN next_number;
END;
$function$;