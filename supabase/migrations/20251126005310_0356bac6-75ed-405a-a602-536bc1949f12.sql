-- Create function to trigger print after order insert
CREATE OR REPLACE FUNCTION trigger_print_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id bigint;
  order_json jsonb;
BEGIN
  -- Build the order JSON payload
  order_json := jsonb_build_object(
    'id', NEW.id,
    'order_number', NEW.order_number,
    'nombre', NEW.nombre,
    'telefono', NEW.telefono,
    'direccion_envio', NEW.direccion_envio,
    'monto', NEW.monto,
    'metodo_pago', NEW.metodo_pago,
    'items', NEW.items,
    'fecha', NEW.fecha,
    'created_at', NEW.created_at
  );

  -- Call the print-order edge function using pg_net
  SELECT net.http_post(
    url := 'https://hdizvbyvtlmkwprhdnzr.supabase.co/functions/v1/print-order',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.supabase_service_role_key', true)
    ),
    body := order_json
  ) INTO request_id;

  RETURN NEW;
END;
$$;

-- Create trigger on orders table
DROP TRIGGER IF EXISTS print_order_on_insert ON orders;

CREATE TRIGGER print_order_on_insert
  AFTER INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION trigger_print_order();