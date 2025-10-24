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

    let { nombre, pedido, monto, telefono, order_id, metodo_pago, items_to_remove } = raw;
    
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
          .replace(/\([^)]*\)/g, '') // Remove prices in parentheses (e.g., "(14500)" or "($14.500)")
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

    // Check if there's a recent pending order from the same phone number (within 40 minutes)
    let existingOrder = null;
    if (telefono) {
      const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString();
      
      const { data: recentOrders, error: searchError } = await supabase
        .from('orders')
        .select('*')
        .eq('telefono', telefono)
        .eq('status', 'pending')
        .gte('created_at', fortyMinutesAgo)
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (!searchError && recentOrders && recentOrders.length > 0) {
        existingOrder = recentOrders[0];
        console.log('Found existing order:', existingOrder.id, 'order_number:', existingOrder.order_number);
      }
    }

    let data;
    let newItems = items;
    let removedItems = [];
    
    if (existingOrder) {
      // Process item removals if provided
      let currentItems = [...(existingOrder.items || [])];
      let currentItemStatus = [...(existingOrder.item_status || [])];
      let amountToSubtract = 0;
      
      if (items_to_remove && Array.isArray(items_to_remove)) {
        // Parse items to remove
        const itemsToRemoveArray = items_to_remove.map(item => 
          typeof item === 'string' ? item : item
        );
        const parsedItemsToRemove = parseItemsFromArray(itemsToRemoveArray);
        
        if (parsedItemsToRemove && parsedItemsToRemove.length > 0) {
          for (const itemToRemove of parsedItemsToRemove) {
            // Find matching items in current order
            let quantityToRemove = itemToRemove.quantity;
            
            for (let i = currentItems.length - 1; i >= 0 && quantityToRemove > 0; i--) {
              const currentItem = currentItems[i];
              
              // Check if items match
              if (currentItem.burger_type === itemToRemove.burger_type &&
                  currentItem.patty_size === itemToRemove.patty_size &&
                  currentItem.combo === itemToRemove.combo &&
                  JSON.stringify(currentItem.additions) === JSON.stringify(itemToRemove.additions) &&
                  JSON.stringify(currentItem.removals) === JSON.stringify(itemToRemove.removals)) {
                
                const removedQuantity = Math.min(currentItem.quantity, quantityToRemove);
                
                // Track removed items for kitchen notification
                removedItems.push({
                  ...currentItem,
                  quantity: removedQuantity
                });
                
                if (currentItem.quantity <= quantityToRemove) {
                  // Remove entire item
                  currentItems.splice(i, 1);
                  currentItemStatus.splice(i, 1);
                  quantityToRemove -= currentItem.quantity;
                } else {
                  // Reduce quantity
                  currentItems[i].quantity -= quantityToRemove;
                  currentItemStatus[i].quantity -= quantityToRemove;
                  quantityToRemove = 0;
                }
              }
            }
          }
          
          // Calculate amount to subtract based on proportion of items removed
          const totalOriginalQuantity = (existingOrder.items || []).reduce((sum, item) => sum + item.quantity, 0);
          const totalRemovedQuantity = removedItems.reduce((sum, item) => sum + item.quantity, 0);
          amountToSubtract = totalOriginalQuantity > 0 
            ? parseFloat(existingOrder.total || 0) * (totalRemovedQuantity / totalOriginalQuantity)
            : 0;
        }
      }
      
      // Deduplicate items - only add items that are truly new
      const existingItems = currentItems;
      const incomingItems = items || [];
      
      // Find truly new items by comparing with existing ones
      const reallyNewItems = [];
      for (const incomingItem of incomingItems) {
        // Count how many times this item appears in existing order
        const existingCount = existingItems.filter(ei => 
          ei.burger_type === incomingItem.burger_type &&
          ei.patty_size === incomingItem.patty_size &&
          ei.combo === incomingItem.combo &&
          JSON.stringify(ei.additions) === JSON.stringify(incomingItem.additions) &&
          JSON.stringify(ei.removals) === JSON.stringify(incomingItem.removals)
        ).reduce((sum, item) => sum + item.quantity, 0);
        
        // Count how many times we've already processed this item as new
        const alreadyAddedCount = reallyNewItems.filter(ni =>
          ni.burger_type === incomingItem.burger_type &&
          ni.patty_size === incomingItem.patty_size &&
          ni.combo === incomingItem.combo &&
          JSON.stringify(ni.additions) === JSON.stringify(incomingItem.additions) &&
          JSON.stringify(ni.removals) === JSON.stringify(incomingItem.removals)
        ).reduce((sum, item) => sum + item.quantity, 0);
        
        // Count in incoming request
        const incomingCount = incomingItem.quantity;
        
        // Only add if incoming count is greater than existing + already added
        const newQuantity = incomingCount - existingCount - alreadyAddedCount;
        if (newQuantity > 0) {
          reallyNewItems.push({
            ...incomingItem,
            quantity: newQuantity
          });
        }
      }
      
      // Calculate the actual new amount based on truly new items
      const actualNewAmount = reallyNewItems.length > 0 ? parseFloat(monto) * (reallyNewItems.reduce((sum, item) => sum + item.quantity, 0) / incomingItems.reduce((sum, item) => sum + item.quantity, 0)) : 0;
      
      newItems = reallyNewItems;
      
      // Update existing order by adding only truly new items
      const updatedItems = [...currentItems, ...reallyNewItems];
      const updatedItemStatus = [
        ...currentItemStatus, 
        ...reallyNewItems.map(item => ({
          burger_type: item.burger_type,
          quantity: item.quantity,
          patty_size: item.patty_size,
          combo: item.combo,
          completed: false
        }))
      ];
      const updatedTotal = parseFloat(existingOrder.total || 0) + actualNewAmount - amountToSubtract;
      
      const { data: updatedData, error: updateError } = await supabase
        .from('orders')
        .update({
          items: updatedItems,
          item_status: updatedItemStatus,
          total: updatedTotal,
          monto: updatedTotal
        })
        .eq('id', existingOrder.id)
        .select()
        .single();
      
      if (updateError) {
        console.error('Update error:', updateError);
        return new Response(JSON.stringify({ error: 'Error updating order' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      data = updatedData;
      console.log('Order updated with new items:', data);
    } else {
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
        monto: monto,
        total: monto,
        items,
        item_status: itemStatus,
        direccion_envio: direccionEnvio,
        telefono: telefono || null,
        fecha: new Date().toISOString(),
        status: 'pending',
        order_number: orderNumber,
        metodo_pago: metodo_pago || 'efectivo'
      };
      
      const { data: newData, error } = await supabase
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

      data = newData;
      console.log('New order created:', data);
    }
    
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
        // Kitchen PDF - Only order number and NEW/REMOVED items
        addText('COCINA', 14, true);
        addText('================================', 8);
        addText(`PEDIDO #${data.order_number}`, 12, true);
        addText('================================', 8);
        
        // Print removed items first if any
        if (removedItems && removedItems.length > 0) {
          addText('ITEMS CANCELADOS:', 10, true);
          removedItems.forEach((item: any) => {
            let itemDesc = `(-) ${item.quantity}x ${item.burger_type} ${item.patty_size}`;
            if (item.combo) itemDesc += ' (combo)';
            if (item.additions) itemDesc += ` +${item.additions.join(', ')}`;
            if (item.removals) itemDesc += ` sin ${item.removals.join(', ')}`;
            addText(itemDesc, 9);
          });
          addText('--------------------------------', 8);
        }
        
        // Print new items if any
        if (newItems && Array.isArray(newItems) && newItems.length > 0) {
          addText('ITEMS NUEVOS:', 10, true);
          newItems.forEach((item: any) => {
            let itemDesc = `(+) ${item.quantity}x ${item.burger_type} ${item.patty_size}`;
            if (item.combo) itemDesc += ' (combo)';
            if (item.additions) itemDesc += ` +${item.additions.join(', ')}`;
            if (item.removals) itemDesc += ` sin ${item.removals.join(', ')}`;
            addText(itemDesc, 9);
          });
        }
        addText('================================', 8);
      } else {
        // Cashier PDF - Full order with ALL items (updated total)
        addText('ROSES BURGERS', 14, true);
        addText('================================', 8);
        addText(`PEDIDO #${data.order_number}`, 12, true);
        addText(`Fecha: ${new Date(data.fecha).toLocaleString('es-AR')}`, 8);
        addText('================================', 8);
        
        addText(`Cliente: ${data.nombre}`, 10);
        if (data.telefono) {
          addText(`Telefono: ${data.telefono}`, 9);
        }
        if (data.direccion_envio) {
          addText(`Direccion: ${data.direccion_envio}`, 8);
        }
        addText('--------------------------------', 8);
        
        addText('ITEMS:', 10, true);
        // Print ALL items (complete order)
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
        addText(`TOTAL: $${data.total}`, 12, true);
        addText('================================', 8);
        addText('Gracias por su compra!', 8);
      }
      
      const pdfBytes = await pdfDoc.save();
      return btoa(String.fromCharCode(...new Uint8Array(pdfBytes)));
    };
    
    // Generate both PDFs and send to webhooks
    try {
      console.log('Generating kitchen PDF with order_number:', data.order_number);
      const kitchenPdfBase64 = await generatePDF('kitchen');
      
      // Send to kitchen webhook
      const kitchenPayload = {
        orderId: data.id,
        orderNumber: data.order_number,
        items: newItems, // Only new items for kitchen
        removedItems: removedItems, // Items that were removed
        pdfBase64: kitchenPdfBase64,
        cliente: data.nombre,
        telefono: data.telefono,
        isUpdate: !!existingOrder,
        metodo_pago: data.metodo_pago
      };
      
      const kitchenResponse = await fetch(kitchenWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kitchenPayload)
      });
      
      if (!kitchenResponse.ok) {
        const errorText = await kitchenResponse.text();
        console.error('Kitchen webhook error:', errorText);
        webhookErrors.push({ webhook: 'kitchen', error: errorText });
      } else {
        console.log('Kitchen webhook sent successfully');
      }
    } catch (error) {
      console.error('Kitchen PDF/webhook error:', error);
      webhookErrors.push({ webhook: 'kitchen', error: error.message });
    }
    
    try {
      console.log('Generating cashier PDF with order_number:', data.order_number);
      const cashierPdfBase64 = await generatePDF('cashier');
      
      // Upload cashier PDF to storage
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([226, 400]);
      const font = await pdfDoc.embedFont(StandardFonts.Courier);
      
      const { width, height } = page.getSize();
      let yPosition = height - 30;
      const lineHeight = 12;
      const margin = 10;
      
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
      
      addText('ROSES BURGERS', 14, true);
      addText('================================', 8);
      addText(`PEDIDO #${data.order_number}`, 12, true);
      addText(`Fecha: ${new Date(data.fecha).toLocaleString('es-AR')}`, 8);
      addText('================================', 8);
      
      addText(`Cliente: ${data.nombre}`, 10);
      if (data.telefono) {
        addText(`Telefono: ${data.telefono}`, 9);
      }
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
      addText(`TOTAL: $${data.total}`, 12, true);
      addText('================================', 8);
      addText('Gracias por su compra!', 8);
      
      const pdfBytes = await pdfDoc.save();
      
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
      
      // Send to cashier webhook
      const cashierPayload = {
        orderId: data.id,
        orderNumber: data.order_number,
        cliente: data.nombre,
        telefono: data.telefono,
        items: data.items, // All items for cashier
        total: data.total,
        direccion: data.direccion_envio,
        fecha: data.fecha,
        pdfBase64: cashierPdfBase64,
        isUpdate: !!existingOrder,
        metodo_pago: data.metodo_pago
      };
      
      try {
        const cashierResponse = await fetch(cashierWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cashierPayload)
        });
        
        if (!cashierResponse.ok) {
          const errorText = await cashierResponse.text();
          console.error('Cashier webhook error:', errorText);
          webhookErrors.push({ webhook: 'cashier', error: errorText });
        } else {
          console.log('Cashier webhook sent successfully');
        }
      } catch (error) {
        console.error('Cashier webhook exception:', error);
        webhookErrors.push({ webhook: 'cashier', error: error.message });
      }
    } catch (error) {
      console.error('Cashier PDF/webhook error:', error);
      webhookErrors.push({ webhook: 'cashier_pdf', error: error.message });
    }
    
    // Check if there were webhook errors
    const hasWebhookErrors = webhookErrors.length > 0;
    
    return new Response(JSON.stringify({ 
      success: !hasWebhookErrors, 
      message: hasWebhookErrors 
        ? 'Order saved but notification failed. Please check n8n workflows.'
        : 'Order received successfully',
      order: data,
      pdfGenerated: true,
      webhookErrors: hasWebhookErrors ? webhookErrors : undefined
    }), {
      status: hasWebhookErrors ? 500 : 200,
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