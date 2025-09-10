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

    const raw = await req.json();
    const { nombre, pedido, monto } = raw;
    
    // Extract address from various fields or from pedido text
    let direccionEnvio =
      (typeof raw.direccion_envio === 'string' && raw.direccion_envio.trim()) ||
      (typeof raw.domicilio === 'string' && raw.domicilio.trim()) ||
      (typeof raw.direccion === 'string' && raw.direccion.trim()) ||
      null;

    // If no address field found, try to extract from pedido text
    if (!direccionEnvio && pedido) {
      // Look for patterns like "domicilio en [address]", "para domicilio en [address]", "entrega en [address]"
      const addressPatterns = [
        // Special pattern for "country" addresses that include lote and familia
        /(?:para\s+)?domicilio\s+en\s+(country[^,\n]*(?:,?\s*lote[^,\n]*)?(?:,?\s*familia[^,\n]*)?)/i,
        /(?:para\s+)?domicilio\s+en\s+([^,\n]+)/i,
        /(?:para\s+)?entrega\s+en\s+([^,\n]+)/i,
        /(?:dirección|direccion):\s*([^,\n]+)/i
      ];
      
      for (const pattern of addressPatterns) {
        const match = pedido.match(pattern);
        if (match && match[1]) {
          direccionEnvio = match[1].trim();
          console.log('Address extracted from pedido:', direccionEnvio);
          break;
        }
      }
    }

    if (!nombre || !pedido || !monto) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields: nombre, pedido, monto' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse items from pedido text
    const parseItems = (pedidoText: string) => {
      const items = [];
      
      // Clean text and split by common separators
      const cleanText = pedidoText.toLowerCase()
        .replace(/\s+y\s+/g, ', ')
        .replace(/\s+con\s+/g, ' con ')
        .replace(/\s+sin\s+/g, ' sin ');
      
      // Enhanced patterns for better item detection
      const itemPatterns = [
        // Pattern: "2x Hamburguesa Clásica", "1x Papas Fritas"
        /(\d+)x?\s+([^,\n]+?)(?=\s*(?:,|$))/gi,
        // Pattern: "2 Ruby Clove dobles", "1 Cheeseburger triple"
        /(\d+)\s+([a-z0-9\s]+(?:doble|triple|simple|burger|cheese|bacon|blue|ruby|clove|smokey|hamburguesa|papas|coca|pepsi|sprite|agua|combo)(?:[^,\n]*?)?)(?=\s*(?:,|y|con|sin|para|$))/gi,
        // Pattern: individual items without explicit quantity
        /(?:^|,\s*)([a-z0-9\s]+(?:doble|triple|simple|burger|cheese|bacon|blue|ruby|clove|smokey|hamburguesa|papas|coca|pepsi|sprite|agua|combo)(?:[^,\n]*?)?)(?=\s*(?:,|y|con|sin|para|$))/gi
      ];
      
      // Try each pattern
      for (const pattern of itemPatterns) {
        const matches = cleanText.match(pattern);
        if (matches && matches.length > 0) {
          matches.forEach(match => {
            const quantityMatch = match.trim().match(/^(\d+)x?\s+(.+)/) || match.trim().match(/^,?\s*(.+)/);
            if (quantityMatch) {
              const quantity = quantityMatch.length > 2 ? parseInt(quantityMatch[1]) : 1;
              let name = quantityMatch.length > 2 ? quantityMatch[2].trim() : quantityMatch[1].trim();
              
              // Clean up the name
              name = name.replace(/^,\s*/, '').replace(/\s+para\s+domicilio.*$/i, '').trim();
              
              // Skip if name is too short or already processed
              if (name.length > 2 && !items.some(item => item.name.toLowerCase() === name.toLowerCase())) {
                items.push({ quantity, name });
              }
            }
          });
          break; // Stop at first successful pattern
        }
      }
      
      return items.length > 0 ? items : null;
    };

    const items = parseItems(pedido);

    // Create item_status array for tracking individual item completion
    const itemStatus = items ? items.map(item => ({
      name: item.name,
      quantity: item.quantity,
      completed: false
    })) : null;

    // Insert the order into the database
    const { data, error } = await supabase
      .from('orders')
      .insert({
        nombre,
        pedido,
        monto: monto,
        total: monto,
        items,
        item_status: itemStatus,
        direccion_envio: direccionEnvio,
        fecha: new Date().toISOString(),
        status: 'pending'
      })
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      return new Response(JSON.stringify({ error: 'Database error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Order received and saved:', data);
    
    // Generate PDF and send to webhook
    const webhookUrl = Deno.env.get('N8N_WEBHOOK_URL');
    let pdfBase64 = null;
    
    try {
      // Generate PDF
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
      
      // PDF Content
      addText('ROSES BURGERS', 14, true);
      addText('================================', 8);
      addText(`PEDIDO #${data.id.slice(-8)}`, 12, true);
      addText(`Fecha: ${new Date(data.fecha).toLocaleString('es-AR')}`, 8);
      addText('================================', 8);
      
      addText(`Cliente: ${data.nombre}`, 10);
      if (data.direccion_envio) {
        addText(`Direccion: ${data.direccion_envio}`, 8);
      }
      addText('--------------------------------', 8);
      
      addText('ITEMS:', 10, true);
      if (data.items && Array.isArray(data.items)) {
        data.items.forEach((item: any) => {
          addText(`${item.quantity}x ${item.name}`, 9);
        });
      } else {
        addText(data.pedido, 9);
      }
      
      addText('--------------------------------', 8);
      addText(`TOTAL: $${data.monto}`, 12, true);
      addText('================================', 8);
      addText('Gracias por su compra!', 8);
      
      const pdfBytes = await pdfDoc.save();
      pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfBytes)));
      
      console.log('PDF generated successfully');
      
      // Upload PDF to storage
      const fileName = `invoice-${data.id}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from('invoices')
        .upload(fileName, pdfBytes, {
          contentType: 'application/pdf',
          upsert: true
        });
        
      if (uploadError) {
        console.error('PDF upload error:', uploadError);
      } else {
        console.log('PDF uploaded successfully:', fileName);
      }
      
    } catch (pdfError) {
      console.error('PDF generation error:', pdfError);
    }
    
    // Send to webhook if URL is configured
    if (webhookUrl && pdfBase64) {
      try {
        const webhookPayload = {
          orderId: data.id,
          cliente: data.nombre,
          pedido: data.pedido,
          items: data.items,
          total: data.monto,
          direccion: data.direccion_envio,
          fecha: data.fecha,
          pdfBase64: pdfBase64
        };
        
        const webhookResponse = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(webhookPayload)
        });
        
        if (webhookResponse.ok) {
          console.log('Webhook sent successfully');
        } else {
          console.error('Webhook error:', await webhookResponse.text());
        }
      } catch (webhookError) {
        console.error('Webhook send error:', webhookError);
      }
    }
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Order received successfully',
      order: data,
      pdfGenerated: !!pdfBase64
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in receive-order function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});