-- Add a column to track individual item completion status
ALTER TABLE orders ADD COLUMN item_status jsonb DEFAULT NULL;

-- Update existing orders to have item_status based on their items
UPDATE orders 
SET item_status = CASE 
  WHEN items IS NOT NULL THEN 
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', item->>'name',
          'quantity', item->>'quantity',
          'completed', false
        )
      )
      FROM jsonb_array_elements(items) AS item
    )
  ELSE NULL
END
WHERE items IS NOT NULL;