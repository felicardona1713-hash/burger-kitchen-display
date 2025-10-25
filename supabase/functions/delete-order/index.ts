import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let raw;
    try {
      const rawBody = await req.text();
      console.log('Raw request body:', rawBody);
      raw = JSON.parse(rawBody);
      console.log('Parsed JSON successfully:', JSON.stringify(raw, null, 2));
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError);
      return new Response(
        JSON.stringify({ 
          error: 'Invalid JSON format', 
          details: parseError.message
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const { order_number } = raw;

    if (!order_number) {
      return new Response(
        JSON.stringify({ error: 'order_number is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find the order by order_number
    const { data: existingOrder, error: findError } = await supabase
      .from('orders')
      .select('*')
      .eq('order_number', order_number)
      .single();

    if (findError || !existingOrder) {
      console.error('Order not found:', findError);
      return new Response(
        JSON.stringify({ error: 'Order not found', details: findError?.message }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if order was created within last 10 minutes
    const orderCreatedAt = new Date(existingOrder.created_at);
    const now = new Date();
    const timeDiffMinutes = (now.getTime() - orderCreatedAt.getTime()) / (1000 * 60);

    if (timeDiffMinutes > 10) {
      return new Response(
        JSON.stringify({ 
          error: 'Cannot delete order', 
          details: 'Order is older than 10 minutes and cannot be deleted'
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Delete the order
    const { error: deleteError } = await supabase
      .from('orders')
      .delete()
      .eq('order_number', order_number);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      return new Response(
        JSON.stringify({ error: 'Failed to delete order', details: deleteError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Order deleted successfully:', order_number);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Order deleted successfully',
        order_number 
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in delete-order function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
