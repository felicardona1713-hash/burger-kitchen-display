-- Enable RLS on tables without it
ALTER TABLE public.n8n_chat_histories ENABLE ROW LEVEL SECURITY;

-- Add basic policy for n8n_chat_histories (adjust based on your needs)
CREATE POLICY "Allow all operations on n8n_chat_histories" 
ON public.n8n_chat_histories 
FOR ALL 
USING (true) 
WITH CHECK (true);