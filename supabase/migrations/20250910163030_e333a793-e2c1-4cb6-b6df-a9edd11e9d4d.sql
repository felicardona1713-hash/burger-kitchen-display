-- Create storage bucket for PDF invoices
INSERT INTO storage.buckets (id, name, public) VALUES ('invoices', 'invoices', true);

-- Create policies for invoice bucket
CREATE POLICY "Allow public read access to invoices" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'invoices');

CREATE POLICY "Allow service role to upload invoices" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = 'invoices');