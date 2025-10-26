import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1/dist/pdf-lib.esm.js';

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

    // Find today's latest order by order_number
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    const { data: orders, error: findError } = await supabase
      .from('orders')
      .select('*')
      .eq('order_number', order_number)
      .gte('created_at', todayISO)
      .order('created_at', { ascending: false })
      .limit(1);

    if (findError || !orders || orders.length === 0) {
      console.error('Order not found:', findError);
      return new Response(
        JSON.stringify({ error: 'Order not found', details: findError?.message }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const existingOrder = orders[0];

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

    // Generate cancellation PDFs and notify printers
    const kitchenWebhookUrl = 'https://n8nwebhookx.botec.tech/webhook/crearFacturaCocina';
    const cashierWebhookUrl = 'https://n8nwebhookx.botec.tech/webhook/crearFacturaCaja';

    const generateCancelPDF = async (type: 'kitchen' | 'cashier') => {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([226, 200]);
      const font = await pdfDoc.embedFont(StandardFonts.Courier);
      let y = 180;
      const line = 12;
      const add = (t: string, s = 12, e = 0) => { page.drawText(t, { x: 10, y, size: s, font, color: rgb(0,0,0) }); y -= line + e; };
      add(type === 'kitchen' ? 'COCINA' : 'CAJA', 12, 2);
      add(`PEDIDO #${existingOrder.order_number}`, 14, 2);
      add('CANCELADO', 16, 4);
      add(`Cliente: ${existingOrder.nombre}`, 10);
      return await pdfDoc.save();
    };

    try {
      const k = await generateCancelPDF('kitchen');
      const c = await generateCancelPDF('cashier');
      const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
      const kitchenB64 = toB64(k);
      const cashierB64 = toB64(c);

      await fetch(kitchenWebhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_number, pdf: kitchenB64, nombre: existingOrder.nombre }) });
      await fetch(cashierWebhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_number, pdf: cashierB64, nombre: existingOrder.nombre }) });
    } catch (e) {
      console.error('Cancel print error:', e);
    }

    // Delete the order by id
    const { error: deleteError } = await supabase
      .from('orders')
      .delete()
      .eq('id', existingOrder.id);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      return new Response(
        JSON.stringify({ error: 'Failed to delete order', details: deleteError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Order deleted successfully:', order_number);

    return new Response(
      JSON.stringify({ success: true, message: 'Order deleted successfully', order_number }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in delete-order function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
