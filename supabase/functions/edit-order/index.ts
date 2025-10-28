import "https://deno.land/x/xhr@0.1.0/mod.ts";
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

          const generateTicketText = (type: 'kitchen' | 'cashier'): Uint8Array | null => {
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
            const MEDIUM_SIZE = [ESC, 0x21, 0x10]; // Double height only
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
            
      // Initialize with center alignment
      addBytes(...CENTER);
      
      if (type === 'kitchen') {
              if (hasItemChanges) {
                addBytes(...DOUBLE_SIZE, ...BOLD_ON);
                addText('COCINA');
                addBytes(...BOLD_OFF, LF);
                newLine();
                addText('MODIFICACION');
                newLine();
                addLine();
                addBytes(...BOLD_ON);
                addText(`PEDIDO #${existingOrder.order_number}`);
                addBytes(...BOLD_OFF, LF, ...MEDIUM_SIZE);
                addLine();
                newLine();
                
                if (removed.length) {
                  addBytes(...BOLD_ON);
                  addText('QUITAR:');
                  addBytes(...BOLD_OFF, LF);
                  newLine();
                  removed.forEach((it: any) => {
                    addText(`${it.quantity}x ${it.burger_type}`);
                    newLine();
                    addText(`${it.patty_size}`);
                    if (it.combo) {
                      newLine();
                      addText('(combo)');
                    }
                    newLine();
                    if (it.additions && it.additions.length > 0) {
                      newLine();
                      addText(`+ ${it.additions.join(', ')}`);
                      newLine();
                    }
                    if (it.removals && it.removals.length > 0) {
                      newLine();
                      addText(`- ${it.removals.join(', ')}`);
                      newLine();
                    }
                    newLine();
                  });
                }
                if (added.length) {
                  addBytes(...BOLD_ON);
                  addText('AGREGAR:');
                  addBytes(...BOLD_OFF, LF);
                  newLine();
                  added.forEach((it: any) => {
                    addText(`${it.quantity}x ${it.burger_type}`);
                    newLine();
                    addText(`${it.patty_size}`);
                    if (it.combo) {
                      newLine();
                      addText('(combo)');
                    }
                    newLine();
                    if (it.additions && it.additions.length > 0) {
                      newLine();
                      addText(`+ ${it.additions.join(', ')}`);
                      newLine();
                    }
                    if (it.removals && it.removals.length > 0) {
                      newLine();
                      addText(`- ${it.removals.join(', ')}`);
                      newLine();
                    }
                    newLine();
                  });
                }
                addBytes(LF, LF, LF, LF, LF);
                addBytes(...CUT);
              } else {
                return null;
              }
            } else {
              addBytes(...DOUBLE_SIZE, ...BOLD_ON);
              addText('CAJA');
              addBytes(...BOLD_OFF, LF);
              newLine();
              addText('MODIFICACION');
              newLine();
              addLine();
              addBytes(...BOLD_ON);
              addText(`PEDIDO #${existingOrder.order_number}`);
              addBytes(...BOLD_OFF, LF, ...MEDIUM_SIZE);
              addLine();
              newLine();
              addText(`Cliente: ${updatedOrder?.nombre || existingOrder.nombre}`);
              newLine();
              newLine();
              
              const tel = updatedOrder?.telefono || existingOrder.telefono;
              const dir = updatedOrder?.direccion_envio || existingOrder.direccion_envio;
              const pago = updatedOrder?.metodo_pago || existingOrder.metodo_pago;
              
              if (tel) {
                addText(`Tel: ${tel}`);
                newLine();
              }
              if (dir) {
                newLine();
                addText(`Entrega:`);
                newLine();
                addText(`${dir}`);
                if (addressChanged) {
                  addText(' (NUEVO)');
                }
                newLine();
              }
              if (pago) {
                newLine();
                addText(`Pago: ${pago}`);
                if (paymentChanged) {
                  addText(' (NUEVO)');
                }
                newLine();
              }
              
              newLine();
              addLine();
              newLine();
              
              addBytes(...BOLD_ON);
              addText('PEDIDO COMPLETO:');
              addBytes(...BOLD_OFF, LF);
              newLine();
              
              const finalItems = updatedOrder?.items || existingOrder.items || [];
              finalItems.forEach((item: any) => {
                const isAdded = added.some((a: any) => isSameItem(a, item));
                const isRemoved = removed.some((r: any) => isSameItem(r, item));
                
                addText(`${item.quantity}x ${item.burger_type}`);
                newLine();
                addText(`${item.patty_size}`);
                if (item.combo) {
                  addText(' (combo)');
                }
                if (isAdded) {
                  addText(' (NUEVA)');
                }
                if (isRemoved) {
                  addText(' (CANCELADA)');
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
              addText(`TOTAL:`);
              newLine();
              addText(`$${(updatedOrder?.monto ?? existingOrder.monto).toLocaleString('es-AR')}`);
              addBytes(...BOLD_OFF, LF);
              addBytes(LF, LF, LF, LF, LF);
              addBytes(...CUT);
            }

            return new Uint8Array(bytes);
          };

          // Generate tickets
          try {
            const kitchenTicketBytes = generateTicketText('kitchen');
            const cashierTicketBytes = generateTicketText('cashier');

            const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

            // Send kitchen webhook only if there are item changes
            if (kitchenTicketBytes !== null) {
              const kitchenB64 = toB64(kitchenTicketBytes);
              try {
                const payloadKitchen = {
                  order_number: existingOrder.order_number,
                  ticket: kitchenB64,
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
            const cashierB64 = toB64(cashierTicketBytes!);

            try {
              const payloadCashier = {
                order_number: existingOrder.order_number,
                ticket: cashierB64,
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
            webhookErrors.push({ type: 'ticket', error: (e as Error).message });
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
