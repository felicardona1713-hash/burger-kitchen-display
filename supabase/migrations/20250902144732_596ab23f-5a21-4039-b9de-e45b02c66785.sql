-- Add status column to orders table to track completed orders
ALTER TABLE public.orders 
ADD COLUMN status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed'));

-- Add index for better performance on status queries
CREATE INDEX idx_orders_status ON public.orders(status);

-- Update RLS policy to allow updates for marking orders as completed
CREATE POLICY "Allow public update for status changes"
ON public.orders
FOR UPDATE
USING (true)
WITH CHECK (true);