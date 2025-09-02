-- Add status column to orders table to track completed orders
ALTER TABLE public.orders 
ADD COLUMN status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed'));

-- Add index for better performance on status queries
CREATE INDEX idx_orders_status ON public.orders(status);

-- Enable realtime for orders table
ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;