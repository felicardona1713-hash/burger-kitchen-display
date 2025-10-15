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
    let { nombre, pedido, monto, telefono, order_number } = raw;
    
    // Convert pedido to array if it's a string
    let pedidoArray: string[];
    if (typeof pedido === 'string') {
      pedidoArray = pedido.split(',').map(p => p.trim());
    } else if (Array.isArray(pedido)) {
      pedidoArray = pedido;
    } else {
      return new Response(JSON.stringify({ 
        error: 'pedido must be a string or array' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Extract address from various fields or from pedido text
    let direccionEnvio =
      (typeof raw.direccion_envio === 'string' && raw.direccion_envio.trim()) ||
      (typeof raw.domicilio === 'string' && raw.domicilio.trim()) ||
      (typeof raw.direccion === 'string' && raw.direccion.trim()) ||
      null;

    // If no address field found, try to extract from pedido array
    if (!direccionEnvio && pedidoArray.length > 0) {
      // Join array to search for address patterns
      const pedidoText = pedidoArray.join(', ');
      const addressPatterns = [
        /(?:para\s+)?domicilio\s+en\s+(country[^,\n]*(?:,?\s*lote[^,\n]*)?(?:,?\s*familia[^,\n]*)?)/i,
        /(?:para\s+)?domicilio\s+en\s+([^,\n]+)/i,
        /(?:para\s+)?entrega\s+en\s+([^,\n]+)/i,
        /(?:dirección|direccion):\s*([^,\n]+)/i
      ];
      
      for (const pattern of addressPatterns) {
        const match = pedidoText.match(pattern);
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

    // Parse items from pedido array with detailed metrics
    const parseItemsFromArray = (pedidoArr: string[]) => {
      const allItems = [];
      
      for (const item of pedidoArr) {
        const originalText = item.trim();
        const cleanText = originalText.toLowerCase();
        
        // Pattern to extract quantity
        const quantityMatch = cleanText.match(/^(\d+)\s*[x×]\s*(.+)$/);
        const quantity = quantityMatch ? parseInt(quantityMatch[1]) : 1;
        let itemText = quantityMatch ? quantityMatch[2].trim() : cleanText;
        let originalItemText = quantityMatch ? originalText.replace(/^\d+\s*[x×]\s*/i, '').trim() : originalText;
        
        // Remove address information
        itemText = itemText.replace(/\s+para\s+domicilio.*$/i, '').trim();
        originalItemText = originalItemText.replace(/\s+para\s+domicilio.*$/i, '').trim();
        
        // Extract patty size (simple, doble, triple)
        let pattySize = 'simple';
        if (itemText.match(/\btriple\b/i)) {
          pattySize = 'triple';
        } else if (itemText.match(/\bdoble\b/i)) {
          pattySize = 'doble';
        }
        
        // Check if it's a combo - if combo is mentioned, it includes fries
        const isCombo = /\b(?:en combo|combo)\b/i.test(itemText);
        
        // Extract removals (sin ...)
        const removals: string[] = [];
        const removalMatches = itemText.matchAll(/\bsin\s+([\w\s]+?)(?=\s+(?:agregado|con|en|$))/gi);
        for (const match of removalMatches) {
          removals.push(match[1].trim());
        }
        
        // Extract additions (agregado ..., but NOT "con papas" if combo)
        const additions: string[] = [];
        const additionMatches = itemText.matchAll(/\b(?:agregado|extra)\s+([\w\s]+?)(?=\s+(?:sin|en|$))/gi);
        for (const match of additionMatches) {
          additions.push(match[1].trim());
        }
        
        // Also capture "con X" that is NOT "con papas" when it's a combo
        const conMatches = itemText.matchAll(/\bcon\s+([\w\s]+?)(?=\s+(?:agregado|sin|en|$))/gi);
        for (const match of conMatches) {
          const item = match[1].trim();
          // If it's NOT "papas fritas" or "papas", or if it's papas but NOT in combo context
          if (!item.match(/^papas(\s+fritas)?$/i) || !isCombo) {
            if (!additions.includes(item) && item !== 'combo') {
              additions.push(item);
            }
          }
        }
        
        // Extract burger name - everything before size/modifiers
        let burgerName = originalItemText
          .replace(/^\d+\s+/g, '') // Remove leading numbers (e.g., "1 cheese burger" -> "cheese burger")
          .replace(/\b(?:simple|doble|triple)\b/gi, '')
          .replace(/\b(?:con papas fritas|con papas|en combo|combo)\b/gi, '')
          .replace(/\bsin\s+[\w\s]+?(?=\s+(?:agregado|con|en|$))/gi, '')
          .replace(/\bagregado\s+[\w\s]+/gi, '')
          .replace(/\bextra\s+[\w\s]+/gi, '')
          .replace(/\bcon\s+[\w\s]+/gi, '')
          .trim();
        
        if (burgerName.length > 0) {
          allItems.push({
            quantity,
            burger_type: burgerName,
            patty_size: pattySize,
            combo: isCombo,
            additions: additions.length > 0 ? additions : null,
            removals: removals.length > 0 ? removals : null
          });
        }
      }
      
      return allItems.length > 0 ? allItems : null;
    };

    const items = parseItemsFromArray(pedidoArray);

    // Create item_status array for tracking individual item completion
    const itemStatus = items ? items.map(item => ({
      burger_type: item.burger_type,
      quantity: item.quantity,
      patty_size: item.patty_size,
      combo: item.combo,
      completed: false
    })) : null;

    // Insert the order into the database
    const orderData: any = {
      nombre,
      monto: monto,
      total: monto,
      items,
      item_status: itemStatus,
      direccion_envio: direccionEnvio,
      telefono: telefono || null,
      fecha: new Date().toISOString(),
      status: 'pending'
    };
    
    // If order_number is provided, include it (otherwise the trigger will set it)
    if (order_number !== undefined && order_number !== null) {
      orderData.order_number = order_number;
    }
    
    const { data, error } = await supabase
      .from('orders')
      .insert(orderData)
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
          let itemDesc = `${item.quantity}x ${item.burger_type} ${item.patty_size}`;
          if (item.combo) itemDesc += ' (combo)';
          if (item.additions) itemDesc += ` +${item.additions.join(', ')}`;
          if (item.removals) itemDesc += ` sin ${item.removals.join(', ')}`;
          addText(itemDesc, 9);
        });
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
