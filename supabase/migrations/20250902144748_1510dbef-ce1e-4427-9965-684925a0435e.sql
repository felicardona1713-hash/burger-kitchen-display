-- Fix RLS issue - enable RLS on n8n_chat_histories_pruebasfeli table
ALTER TABLE public.n8n_chat_histories_pruebasfeli ENABLE ROW LEVEL SECURITY;

-- Add policy to allow inserts from webhook (public access for n8n)
CREATE POLICY "Allow webhook inserts" 
ON public.n8n_chat_histories_pruebasfeli 
FOR INSERT 
WITH CHECK (true);

-- Add policy to allow reads (if needed)
CREATE POLICY "Allow public read" 
ON public.n8n_chat_histories_pruebasfeli 
FOR SELECT 
USING (true);