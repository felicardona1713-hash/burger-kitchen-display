import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse JSON with better error handling
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

    const { nombre, items, monto, telefono, direccion_envio, metodo_pago } = raw;

    if (!nombre || !items || !monto) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields: nombre, items, monto' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!Array.isArray(items)) {
      return new Response(JSON.stringify({ 
        error: 'items must be an array' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create item_status array for tracking individual item completion
    const itemStatus = items.map(item => ({
      ...item,
      completed: false
    }));

    // Get the next order number
    const { data: orderNumberData, error: orderNumberError } = await supabase
      .rpc('get_daily_order_number');
    
    if (orderNumberError) {
      console.error('Error getting order number:', orderNumberError);
      return new Response(JSON.stringify({ error: 'Error generating order number' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const orderNumber = orderNumberData;
    console.log('Generated order number:', orderNumber);

    // Insert new order into the database
    const orderData: any = {
      nombre,
      monto: parseFloat(monto),
      items,
      item_status: itemStatus,
      direccion_envio: direccion_envio || null,
      telefono: telefono || null,
      fecha: new Date().toISOString(),
      status: 'pending',
      order_number: orderNumber,
      metodo_pago: metodo_pago || 'efectivo'
    };
    
    const { data, error } = await supabase
      .from('orders')
      .insert(orderData)
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      return new Response(JSON.stringify({ error: 'Database error', details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('New order created:', data);
    
    // Generate PDFs for kitchen and cashier
    const kitchenWebhookUrl = 'https://n8nwebhookx.botec.tech/webhook/crearFacturaCocina';
    const cashierWebhookUrl = 'https://n8nwebhookx.botec.tech/webhook/crearFacturaCaja';
    
    // Track webhook errors
    const webhookErrors = [];
    
    // Helper function to generate ESC/POS ticket
    const generateTicket = (type: 'kitchen' | 'cashier'): Uint8Array => {
      const bytes: number[] = [];
      
      // ESC/POS commands
      const ESC = 0x1B;
      const GS = 0x1D;
      const LF = 0x0A;
      const CENTER = [ESC, 0x61, 0x01];
      const LEFT = [ESC, 0x61, 0x00];
      const BOLD_ON = [ESC, 0x45, 0x01];
      const BOLD_OFF = [ESC, 0x45, 0x00];
      const DOUBLE_SIZE = [ESC, 0x21, 0x30]; // Double width and height
      const NORMAL_SIZE = [ESC, 0x21, 0x00]; // Normal size
      const CUT = [GS, 0x56, 0x00];
      
      const addBytes = (...b: number[]) => bytes.push(...b);
      const addText = (text: string) => {
        const encoder = new TextEncoder();
        addBytes(...Array.from(encoder.encode(text)));
      };
      const addLine = () => {
        addText('================================');
        addBytes(LF);
      };
      const newLine = () => addBytes(LF);
      
      // Initialize with center alignment and larger font
      addBytes(...CENTER, ...DOUBLE_SIZE);
      
      if (type === 'kitchen') {
        // Kitchen ticket - Order items for preparation
        addBytes(...BOLD_ON);
        addText('COCINA');
        addBytes(...BOLD_OFF, LF);
        addLine();
        addBytes(...BOLD_ON);
        addText(`PEDIDO #${data.order_number}`);
        addBytes(...BOLD_OFF, LF);
        addLine();
        newLine();
        
        // Print all items
        data.items.forEach((item: any) => {
          let itemDesc = `${item.quantity}x ${item.burger_type}`;
          newLine();
          addText(itemDesc);
          newLine();
          addText(`${item.patty_size}`);
          if (item.combo) {
            newLine();
            addText('(combo)');
          }
          newLine();
          
          if (item.additions && item.additions.length > 0) {
            newLine();
            addText(`+ ${item.additions.join(', ')}`);
            newLine();
          }
          if (item.removals && item.removals.length > 0) {
            newLine();
            addText(`- ${item.removals.join(', ')}`);
            newLine();
          }
          newLine();
        });
        
      } else {
        // Cashier ticket - Complete order details
        addBytes(...BOLD_ON);
        addText('CAJA');
        addBytes(...BOLD_OFF, LF);
        addLine();
        addBytes(...BOLD_ON);
        addText(`PEDIDO #${data.order_number}`);
        addBytes(...BOLD_OFF, LF);
        addLine();
        newLine();
        addText(`Cliente: ${data.nombre}`);
        newLine();
        if (data.telefono) {
          newLine();
          addText(`Tel: ${data.telefono}`);
          newLine();
        }
        if (data.direccion_envio) {
          newLine();
          addText(`Entrega:`);
          newLine();
          addText(`${data.direccion_envio}`);
          newLine();
        }
        newLine();
        addLine();
        newLine();
        
        // Print all items with prices
        data.items.forEach((item: any) => {
          let itemDesc = `${item.quantity}x ${item.burger_type}`;
          addText(itemDesc);
          newLine();
          addText(`${item.patty_size}`);
          if (item.combo) {
            addText(' (combo)');
          }
          newLine();
          
          if (item.additions && item.additions.length > 0) {
            newLine();
            addText(`+ ${item.additions.join(', ')}`);
            newLine();
          }
          if (item.removals && item.removals.length > 0) {
            newLine();
            addText(`- ${item.removals.join(', ')}`);
            newLine();
          }
          if (item.price) {
            newLine();
            addText(`$${parseFloat(item.price).toLocaleString('es-AR')}`);
            newLine();
          }
          newLine();
        });
        
        addLine();
        newLine();
        addBytes(...BOLD_ON);
        addText(`TOTAL: $${parseFloat(data.monto).toLocaleString('es-AR')}`);
        addBytes(...BOLD_OFF, LF);
        newLine();
        addText(`Pago: ${data.metodo_pago}`);
        newLine();
      }
      
      addBytes(LF, LF, LF);
      addBytes(...CUT);
      
      return new Uint8Array(bytes);
    };
    
    // Generate kitchen ticket
    console.log('Generating kitchen ticket with order_number:', data.order_number);
    const kitchenTicketBytes = generateTicket('kitchen');
    const kitchenTicketBase64 = btoa(String.fromCharCode(...kitchenTicketBytes));
    
    // Send kitchen webhook
    try {
      const kitchenWebhookResponse = await fetch(kitchenWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order_number: data.order_number,
          ticket: kitchenTicketBase64,
          items: data.items,
          nombre: data.nombre
        }),
      });
      
      if (!kitchenWebhookResponse.ok) {
        const errorText = await kitchenWebhookResponse.text();
        throw new Error(`Kitchen webhook failed: ${kitchenWebhookResponse.status} - ${errorText}`);
      }
      
      console.log('Kitchen webhook sent successfully');
    } catch (error) {
      console.error('Kitchen webhook error:', error);
      webhookErrors.push({ type: 'kitchen', error: error.message });
    }
    
    // Generate cashier ticket
    console.log('Generating cashier ticket with order_number:', data.order_number);
    const cashierTicketBytes = generateTicket('cashier');
    const cashierTicketBase64 = btoa(String.fromCharCode(...cashierTicketBytes));

    // Send cashier webhook
    try {
      const cashierWebhookResponse = await fetch(cashierWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order_number: data.order_number,
          ticket: cashierTicketBase64,
          nombre: data.nombre,
          telefono: data.telefono,
          monto: data.monto,
          metodo_pago: data.metodo_pago,
          items: data.items,
          direccion_envio: data.direccion_envio
        }),
      });
      
      if (!cashierWebhookResponse.ok) {
        const errorText = await cashierWebhookResponse.text();
        throw new Error(`Cashier webhook failed: ${cashierWebhookResponse.status} - ${errorText}`);
      }
      
      console.log('Cashier webhook sent successfully');
    } catch (error) {
      console.error('Cashier webhook error:', error);
      webhookErrors.push({ type: 'cashier', error: error.message });
    }

    const response = {
      success: true,
      order: data,
      webhookErrors: webhookErrors.length > 0 ? webhookErrors : undefined
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
