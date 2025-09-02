-- Add columns for better order structure
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS items jsonb,
ADD COLUMN IF NOT EXISTS direccion_envio text;