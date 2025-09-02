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
        /(?:entrega\s+)?en\s+([^,\n]+)/i,
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
      // Look for patterns like "2 Ruby Clove dobles", "1 1967 doble"
      const itemMatches = pedidoText.match(/(\d+)\s+([^,]+?)(?:,|$)/g);
      
      if (itemMatches) {
        itemMatches.forEach(match => {
          const cleanMatch = match.replace(/,$/, '').trim();
          const quantityMatch = cleanMatch.match(/^(\d+)\s+(.+)/);
          if (quantityMatch) {
            const quantity = parseInt(quantityMatch[1]);
            const name = quantityMatch[2].trim();
            items.push({ quantity, name });
          }
        });
      }
      
      return items.length > 0 ? items : null;
    };

    const items = parseItems(pedido);

    // Insert the order into the database
    const { data, error } = await supabase
      .from('orders')
      .insert({
        nombre,
        pedido,
        monto: monto,
        total: monto,
        items,
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
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Order received successfully',
      order: data
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