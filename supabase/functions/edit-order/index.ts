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

    const { order_number, nombre, items, monto, telefono, direccion_envio, metodo_pago } = raw;

    if (!order_number) {
      return new Response(
        JSON.stringify({ error: 'order_number is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find the order by order_number from today (get the most recent one)
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


    // Prepare update data
    const updateData: any = {};
    if (nombre !== undefined) updateData.nombre = nombre;
    if (items !== undefined) {
      updateData.items = items;
      // Update item_status to match new items
      updateData.item_status = items.map((item: any) => ({
        ...item,
        completed: false
      }));
    }
    if (monto !== undefined) updateData.monto = monto;
    if (telefono !== undefined) updateData.telefono = telefono;
    if (direccion_envio !== undefined) updateData.direccion_envio = direccion_envio;
    if (metodo_pago !== undefined) updateData.metodo_pago = metodo_pago;

    // Update the order using the specific ID
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', existingOrder.id)
      .select()
      .single();

    if (updateError) {
      console.error('Update error:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update order', details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Order updated successfully:', updatedOrder);

    // Prepare modification printouts for kitchen and cashier when items changed
    const webhookErrors: Array<{ type: string; error: string }> = [];

    try {
      // Check if non-item fields changed (direccion_envio, telefono, metodo_pago)
      const addressChanged = direccion_envio !== undefined && direccion_envio !== existingOrder.direccion_envio;
      const phoneChanged = telefono !== undefined && telefono !== existingOrder.telefono;
      const paymentChanged = metodo_pago !== undefined && metodo_pago !== existingOrder.metodo_pago;
      const nonItemFieldsChanged = addressChanged || phoneChanged || paymentChanged;

      if (Array.isArray(items)) {
        const oldItems = Array.isArray(existingOrder.items) ? existingOrder.items as any[] : [];
        const newItems = items as any[];

        const normalize = (it: any) => ({
          burger_type: (it?.burger_type || '').toString().trim().toLowerCase(),
          patty_size: (it?.patty_size || '').toString().trim().toLowerCase(),
          combo: Boolean(it?.combo),
          additions: Array.isArray(it?.additions)
            ? [...it.additions].map((s: any) => (s ?? '').toString().trim().toLowerCase()).sort()
            : [],
          removals: Array.isArray(it?.removals)
            ? [...it.removals].map((s: any) => (s ?? '').toString().trim().toLowerCase()).sort()
            : [],
        });

        const isSameItem = (a: any, b: any) => {
          const na = normalize(a);
          const nb = normalize(b);
          return (
            na.burger_type === nb.burger_type &&
            na.patty_size === nb.patty_size &&
            na.combo === nb.combo &&
            JSON.stringify(na.additions) === JSON.stringify(nb.additions) &&
            JSON.stringify(na.removals) === JSON.stringify(nb.removals)
          );
        };

        const added: any[] = [];
        const removed: any[] = [];

        // Find added items or increased quantities
        newItems.forEach((ni) => {
          const match = oldItems.find((oi) => isSameItem(oi, ni));
          if (!match) {
            added.push(ni);
          } else {
            const oldQ = Number(match.quantity ?? 1);
            const newQ = Number(ni.quantity ?? 1);
            if (newQ > oldQ) {
              added.push({ ...ni, quantity: newQ - oldQ });
            }
          }
        });

        // Find removed items or decreased quantities
        oldItems.forEach((oi) => {
          const match = newItems.find((ni) => isSameItem(ni, oi));
          if (!match) {
            removed.push(oi);
          } else {
            const oldQ = Number(oi.quantity ?? 1);
            const newQ = Number(match.quantity ?? 1);
            if (newQ < oldQ) {
              removed.push({ ...oi, quantity: oldQ - newQ });
            }
          }
        });

        const hasItemChanges = added.length > 0 || removed.length > 0;
        const hasChanges = hasItemChanges || nonItemFieldsChanged;

        // Detect simple swap (one removed and one added with same qty)
        const isSwap =
          added.length === 1 &&
          removed.length === 1 &&
          Number(added[0].quantity ?? 1) === Number(removed[0].quantity ?? 1);

        console.log('edit-order change detection:', {
          order_number: existingOrder.order_number,
          added,
          removed,
          isSwap,
          addressChanged,
          phoneChanged,
          paymentChanged,
        });
        if (hasChanges) {
          const kitchenWebhookUrl = 'https://n8nwebhookx.botec.tech/webhook/crearFacturaCocina';
          const cashierWebhookUrl = 'https://n8nwebhookx.botec.tech/webhook/crearFacturaCaja';

            const formatItem = (item: any) => {
            let t = `${item.quantity || 1}x ${item.burger_type} ${item.patty_size}`;
            if (item.combo) t += ' (combo)';
            if (item.additions && item.additions.length) t += ` + ${item.additions.join(', ')}`;
            if (item.removals && item.removals.length) t += ` - ${item.removals.join(', ')}`;
            return t;
          };

          const generatePDF = async (type: 'kitchen' | 'cashier') => {
            const pdfDoc = await PDFDocument.create();
            const page = pdfDoc.addPage([226, 400]);
            const font = await pdfDoc.embedFont(StandardFonts.Courier);
            const lineHeight = 12;
            let y = 380;
            const add = (text: string, size = 10, extra = 0) => {
              page.drawText(text, { x: 10, y, size, font, color: rgb(0,0,0) });
              y -= lineHeight + extra;
            };

            if (type === 'kitchen') {
              // COCINA: Mostrar cambios de items con secciones claras
              if (hasItemChanges) {
                add('COCINA', 12, 2);
                add(`MODIFICACION PEDIDO #${existingOrder.order_number}`, 11, 2);
                if (removed.length) {
                  add('QUITAR:', 10, 0);
                  removed.forEach((it: any) => add(`- ${formatItem(it)}`, 10));
                  y -= 4;
                }
                if (added.length) {
                  add('AGREGAR:', 10, 0);
                  added.forEach((it: any) => add(`+ ${formatItem(it)}`, 10));
                }
              } else {
                // Si solo cambió dirección/teléfono/pago, no enviar a cocina
                return null;
              }
            } else {
              // CAJA: Mostrar pedido completo con marcas
              add('CAJA', 12, 2);
              add(`MODIFICACION PEDIDO #${existingOrder.order_number}`, 11, 2);
              add(`Cliente: ${updatedOrder?.nombre || existingOrder.nombre}`, 9, 2);
              
              y -= 4;
              add('PEDIDO COMPLETO:', 10, 0);
              
              const finalItems = updatedOrder?.items || existingOrder.items || [];
              finalItems.forEach((item: any) => {
                const isAdded = added.some((a: any) => isSameItem(a, item));
                const isRemoved = removed.some((r: any) => isSameItem(r, item));
                
                let itemText = formatItem(item);
                if (isAdded) itemText += ' (AGREGADA)';
                if (isRemoved) itemText += ' (CANCELADA)';
                
                add(itemText, 9);
              });
              
              y -= 4;
              const tel = updatedOrder?.telefono || existingOrder.telefono;
              const dir = updatedOrder?.direccion_envio || existingOrder.direccion_envio;
              const pago = updatedOrder?.metodo_pago || existingOrder.metodo_pago;
              
              if (tel) add(`Tel: ${tel}`, 9);
              if (dir) {
                add(`Domicilio: ${dir}${addressChanged ? ' (NUEVO)' : ''}`, 9);
              }
              if (pago) add(`Pago: ${pago}${paymentChanged ? ' (NUEVO)' : ''}`, 9);
              add(`Monto: $${updatedOrder?.monto ?? existingOrder.monto}`, 10);
            }

            return await pdfDoc.save();
          };

          // Generate PDFs
          try {
            const kitchenPdfResult = await generatePDF('kitchen');
            const cashierPdf = await generatePDF('cashier');

            const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

            // Send kitchen webhook only if there are item changes
            if (kitchenPdfResult !== null) {
              const kitchenB64 = toB64(kitchenPdfResult);
              try {
                const payloadKitchen = {
                  order_number: existingOrder.order_number,
                  pdf: kitchenB64,
                  nombre: updatedOrder?.nombre || existingOrder.nombre,
                  items: (updatedOrder?.items || existingOrder.items || []),
                  items_added: added,
                  items_removed: removed,
                  is_swap: isSwap,
                  tipo: 'modificacion',
                  telefono: updatedOrder?.telefono || existingOrder.telefono || null,
                  direccion_envio: updatedOrder?.direccion_envio || existingOrder.direccion_envio || null,
                  monto: (updatedOrder?.monto ?? existingOrder.monto),
                  metodo_pago: updatedOrder?.metodo_pago || existingOrder.metodo_pago || null,
                };
                console.log('edit-order sending kitchen webhook', { order_number: existingOrder.order_number, added_count: added.length, removed_count: removed.length, isSwap });
                const rk = await fetch(kitchenWebhookUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payloadKitchen)
                });
                if (!rk.ok) throw new Error(`Kitchen webhook ${rk.status}`);
                console.log('edit-order kitchen webhook sent', { order_number: existingOrder.order_number });
              } catch (e) {
                const msg = (e as Error).message;
                console.error('edit-order kitchen webhook error', msg);
                webhookErrors.push({ type: 'kitchen', error: msg });
              }
            } else {
              console.log('edit-order skipping kitchen webhook (no item changes)', { order_number: existingOrder.order_number });
            }

            // Always send cashier webhook
            const cashierB64 = toB64(cashierPdf);

            try {
              const payloadCashier = {
                order_number: existingOrder.order_number,
                pdf: cashierB64,
                nombre: updatedOrder?.nombre || existingOrder.nombre,
                items: (updatedOrder?.items || existingOrder.items || []),
                items_added: added,
                items_removed: removed,
                is_swap: isSwap,
                tipo: 'modificacion',
                telefono: updatedOrder?.telefono || existingOrder.telefono || null,
                direccion_envio: updatedOrder?.direccion_envio || existingOrder.direccion_envio || null,
                monto: (updatedOrder?.monto ?? existingOrder.monto),
                metodo_pago: updatedOrder?.metodo_pago || existingOrder.metodo_pago || null,
                address_changed: addressChanged,
                phone_changed: phoneChanged,
                payment_changed: paymentChanged,
              };
              console.log('edit-order sending cashier webhook', { 
                order_number: existingOrder.order_number, 
                added_count: added.length, 
                removed_count: removed.length, 
                isSwap,
                addressChanged,
                phoneChanged,
                paymentChanged
              });
              const rc = await fetch(cashierWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadCashier)
              });
              if (!rc.ok) throw new Error(`Cashier webhook ${rc.status}`);
              console.log('edit-order cashier webhook sent', { order_number: existingOrder.order_number });
            } catch (e) {
              const msg = (e as Error).message;
              console.error('edit-order cashier webhook error', msg);
              webhookErrors.push({ type: 'cashier', error: msg });
            }
          } catch (e) {
            webhookErrors.push({ type: 'pdf', error: (e as Error).message });
          }

          return new Response(
            JSON.stringify({ success: true, order: updatedOrder, added, removed, isSwap, webhookErrors: webhookErrors.length ? webhookErrors : undefined }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    } catch (e) {
      webhookErrors.push({ type: 'unexpected', error: (e as Error).message });
    }

    // No item changes or print fallback
    return new Response(
      JSON.stringify({ success: true, order: updatedOrder }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in edit-order function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
