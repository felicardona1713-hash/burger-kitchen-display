-- Change pedido column from text to text array
ALTER TABLE orders 
ALTER COLUMN pedido TYPE text[] 
USING CASE 
  WHEN pedido IS NULL THEN NULL
  ELSE string_to_array(pedido, ',')
END;