import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1/dist/pdf-lib.esm.js';

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
    
    // Helper function to generate PDF
    const generatePDF = async (type: 'kitchen' | 'cashier') => {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([226, 400]); // 80mm width
      const font = await pdfDoc.embedFont(StandardFonts.Courier);
      
      const { width, height } = page.getSize();
      let yPosition = height - 30;
      const lineHeight = 12;
      const margin = 10;
      
      // Helper function to add text lines
      const addText = (text: string, size = 10, bold = false) => {
        page.drawText(text, {
          x: margin,
          y: yPosition,
          size,
          font,
          color: rgb(0, 0, 0),
        });
        yPosition -= lineHeight + (bold ? 2 : 0);
      };
      
      if (type === 'kitchen') {
        // Kitchen PDF - Order items for preparation
        addText('COCINA', 14, true);
        addText('================================', 8);
        addText(`PEDIDO #${data.order_number}`, 12, true);
        addText('================================', 8);
        
        // Print all items
        data.items.forEach((item: any) => {
          let itemDesc = `${item.quantity}x ${item.burger_type} ${item.patty_size}`;
          if (item.combo) itemDesc += ' (combo)';
          addText(itemDesc, 10);
          
          if (item.additions && item.additions.length > 0) {
            addText(`  + ${item.additions.join(', ')}`, 8);
          }
          if (item.removals && item.removals.length > 0) {
            addText(`  - ${item.removals.join(', ')}`, 8);
          }
        });
        
      } else {
        // Cashier PDF - Complete order details
        addText('CAJA', 14, true);
        addText('================================', 8);
        addText(`PEDIDO #${data.order_number}`, 12, true);
        addText('================================', 8);
        addText(`Cliente: ${data.nombre}`, 10);
        if (data.telefono) addText(`Tel: ${data.telefono}`, 10);
        if (data.direccion_envio) addText(`Entrega: ${data.direccion_envio}`, 10);
        addText('--------------------------------', 8);
        
        // Print all items with prices
        data.items.forEach((item: any) => {
          let itemDesc = `${item.quantity}x ${item.burger_type} ${item.patty_size}`;
          if (item.combo) itemDesc += ' (combo)';
          addText(itemDesc, 10);
          
          if (item.additions && item.additions.length > 0) {
            addText(`  + ${item.additions.join(', ')}`, 8);
          }
          if (item.removals && item.removals.length > 0) {
            addText(`  - ${item.removals.join(', ')}`, 8);
          }
          if (item.price) {
            addText(`  $${parseFloat(item.price).toLocaleString('es-AR')}`, 9);
          }
        });
        
        addText('================================', 8);
        addText(`TOTAL: $${parseFloat(data.monto).toLocaleString('es-AR')}`, 12, true);
        addText(`Pago: ${data.metodo_pago}`, 10);
      }
      
      const pdfBytes = await pdfDoc.save();
      return pdfBytes;
    };
    
    // Generate kitchen PDF
    console.log('Generating kitchen PDF with order_number:', data.order_number);
    const kitchenPdfBytes = await generatePDF('kitchen');
    const kitchenPdfBase64 = btoa(String.fromCharCode(...new Uint8Array(kitchenPdfBytes)));
    
    // Send kitchen webhook
    try {
      const kitchenWebhookResponse = await fetch(kitchenWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order_number: data.order_number,
          pdf: kitchenPdfBase64,
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
    
    // Generate cashier PDF
    console.log('Generating cashier PDF with order_number:', data.order_number);
    const cashierPdfBytes = await generatePDF('cashier');
    
    // Upload PDF to Supabase Storage
    const pdfFileName = `invoice-${data.id}.pdf`;
    const { error: uploadError } = await supabase
      .storage
      .from('invoices')
      .upload(pdfFileName, cashierPdfBytes, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError);
    } else {
      console.log('PDF uploaded successfully:', pdfFileName);
    }

    // Get public URL
    const { data: { publicUrl } } = supabase
      .storage
      .from('invoices')
      .getPublicUrl(pdfFileName);

    const cashierPdfBase64 = btoa(String.fromCharCode(...new Uint8Array(cashierPdfBytes)));

    // Send cashier webhook
    try {
      const cashierWebhookResponse = await fetch(cashierWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order_number: data.order_number,
          pdf: cashierPdfBase64,
          pdf_url: publicUrl,
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
