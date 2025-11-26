import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    const orderData = await req.json();
    console.log('Printing order:', orderData);

    const kitchenWebhookUrl = 'https://n8nwebhookx.botec.tech/webhook/crearFacturaCocina';
    const cashierWebhookUrl = 'https://n8nwebhookx.botec.tech/webhook/crearFacturaCaja';
    
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
      const DOUBLE_SIZE = [ESC, 0x21, 0x30];
      const MEDIUM_SIZE = [ESC, 0x21, 0x10];
      const NORMAL_SIZE = [ESC, 0x21, 0x00];
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
      
      addBytes(...CENTER);
      
      if (type === 'kitchen') {
        addBytes(...DOUBLE_SIZE, ...BOLD_ON);
        addText('COCINA');
        addBytes(...BOLD_OFF, LF);
        addLine();
        addBytes(...BOLD_ON);
        addText(`PEDIDO #${orderData.order_number}`);
        addBytes(...BOLD_OFF, LF, ...MEDIUM_SIZE);
        addLine();
        newLine();
        
        orderData.items.forEach((item: any) => {
          let itemDesc = `${item.quantity}x ${item.burger_type} ${item.patty_size}`;
          if (item.combo) {
            itemDesc += ' (combo)';
          }
          newLine();
          addText(itemDesc);
          newLine();
          
          if (item.additions && item.additions.length > 0) {
            addText(`+ ${item.additions.join(', ')}`);
            newLine();
          }
          if (item.removals && item.removals.length > 0) {
            addText(`- ${item.removals.join(', ')}`);
            newLine();
          }
        });
        
      } else {
        addBytes(...DOUBLE_SIZE, ...BOLD_ON);
        addText('CAJA');
        addBytes(...BOLD_OFF, LF);
        addLine();
        addBytes(...BOLD_ON);
        addText(`PEDIDO #${orderData.order_number}`);
        addBytes(...BOLD_OFF, LF, ...MEDIUM_SIZE);
        addLine();
        newLine();
        addText(`Cliente: ${orderData.nombre}`);
        newLine();
        if (orderData.telefono) {
          newLine();
          addText(`Tel: ${orderData.telefono}`);
          newLine();
        }
        if (orderData.direccion_envio) {
          newLine();
          addText(`Entrega:`);
          newLine();
          addText(`${orderData.direccion_envio}`);
          newLine();
        }
        newLine();
        addLine();
        newLine();
        
        orderData.items.forEach((item: any) => {
          let itemDesc = `${item.quantity}x ${item.burger_type} ${item.patty_size}`;
          if (item.combo) {
            itemDesc += ' (combo)';
          }
          if (item.price) {
            itemDesc += ` $${parseFloat(item.price).toLocaleString('es-AR')}`;
          }
          newLine();
          addText(itemDesc);
          newLine();
          
          if (item.additions && item.additions.length > 0) {
            addText(`+ ${item.additions.join(', ')}`);
            newLine();
          }
          if (item.removals && item.removals.length > 0) {
            addText(`- ${item.removals.join(', ')}`);
            newLine();
          }
        });
        
        addLine();
        newLine();
        addBytes(...BOLD_ON);
        addText(`TOTAL: $${parseFloat(orderData.monto).toLocaleString('es-AR')}`);
        addBytes(...BOLD_OFF, LF);
        newLine();
        addText(`Pago: ${orderData.metodo_pago}`);
        newLine();
      }
      
      addBytes(LF, LF, LF, LF, LF);
      addBytes(...CUT);
      
      return new Uint8Array(bytes);
    };
    
    // Generate kitchen ticket
    console.log('Generating kitchen ticket for order:', orderData.order_number);
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
          order_number: orderData.order_number,
          ticket: kitchenTicketBase64,
          items: orderData.items,
          nombre: orderData.nombre
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
    console.log('Generating cashier ticket for order:', orderData.order_number);
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
          order_number: orderData.order_number,
          ticket: cashierTicketBase64,
          nombre: orderData.nombre,
          telefono: orderData.telefono,
          monto: orderData.monto,
          metodo_pago: orderData.metodo_pago,
          items: orderData.items,
          direccion_envio: orderData.direccion_envio
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
      order_number: orderData.order_number,
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