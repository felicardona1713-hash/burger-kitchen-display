-- Remove the trigger and function that's causing the error
DROP TRIGGER IF EXISTS print_order_on_insert ON orders;
DROP FUNCTION IF EXISTS trigger_print_order();