-- Fix security warnings by setting search_path for functions
ALTER FUNCTION get_daily_order_number() SET search_path = public;
ALTER FUNCTION set_daily_order_number() SET search_path = public;