import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { formatDistance } from "date-fns";
import { es } from "date-fns/locale";
import { Check, Clock, DollarSign, ChefHat, Printer } from "lucide-react";

interface OrderItem {
  quantity: number;
  burger_type: string;
  patty_size: string;
  combo: boolean;
  additions?: string[] | null;
  removals?: string[] | null;
}

interface ItemStatus {
  burger_type: string;
  quantity: number;
  patty_size: string;
  combo: boolean;
  completed: boolean;
}

interface Order {
  id: string;
  nombre: string;
  total: number;
  fecha: string;
  status: string;
  created_at: string;
  items?: OrderItem[];
  item_status?: ItemStatus[];
  direccion_envio?: string;
  order_number: number;
}

const Index = () => {
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [completedOrders, setCompletedOrders] = useState<Order[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    // Fetch initial orders
    const fetchOrders = async () => {
      const { data: pending, error: pendingError } = await supabase
        .from('orders')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      
      const { data: completed, error: completedError } = await supabase
        .from('orders')
        .select('*')
        .eq('status', 'completed')
        .order('created_at', { ascending: false });
      
      if (pendingError) console.error('Error fetching pending orders:', pendingError);
      else {
        const typedPending = (pending || []).map(order => ({
          ...order,
          items: Array.isArray(order.items) ? order.items as unknown as OrderItem[] : undefined,
          item_status: Array.isArray(order.item_status) ? order.item_status as unknown as ItemStatus[] : undefined
        }));
        setPendingOrders(typedPending);
      }
      
      if (completedError) console.error('Error fetching completed orders:', completedError);
      else {
        const typedCompleted = (completed || []).map(order => ({
          ...order,
          items: Array.isArray(order.items) ? order.items as unknown as OrderItem[] : undefined,
          item_status: Array.isArray(order.item_status) ? order.item_status as unknown as ItemStatus[] : undefined
        }));
        setCompletedOrders(typedCompleted);
      }
    };

    fetchOrders();

    // Subscribe to real-time changes
    const channel = supabase
      .channel('orders-dashboard')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders'
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newOrder = payload.new as Order;
            if (newOrder.status === 'pending') {
              setPendingOrders(prev => {
                const updatedOrders = [newOrder, ...prev];
                // Imprimir automáticamente el nuevo pedido
                setTimeout(() => {
                  printSingleOrder(newOrder);
                }, 500); // Pequeño delay para asegurar que el estado se actualice
                return updatedOrders;
              });
              toast({
                title: "¡Nuevo Pedido!",
                description: `${newOrder.nombre} - $${newOrder.total}`,
                duration: 5000,
              });
            }
          } else if (payload.eventType === 'UPDATE') {
            const updatedOrder = payload.new as Order;
            if (updatedOrder.status === 'completed') {
              setPendingOrders(prev => prev.filter(order => order.id !== updatedOrder.id));
              setCompletedOrders(prev => [updatedOrder, ...prev]);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [toast]);

  const toggleItemCompleted = async (orderId: string, itemIndex: number) => {
    const order = pendingOrders.find(o => o.id === orderId);
    if (!order || !order.item_status) return;

    const updatedItemStatus = [...order.item_status];
    updatedItemStatus[itemIndex] = {
      ...updatedItemStatus[itemIndex],
      completed: !updatedItemStatus[itemIndex].completed
    };

    const { error } = await supabase
      .from('orders')
      .update({ item_status: updatedItemStatus as any })
      .eq('id', orderId);

    if (error) {
      console.error('Error updating item status:', error);
      toast({
        title: "Error",
        description: "No se pudo actualizar el estado del item",
        variant: "destructive"
      });
    } else {
      // Update local state
      setPendingOrders(prev => prev.map(o => 
        o.id === orderId 
          ? { ...o, item_status: updatedItemStatus }
          : o
      ));
      
      const item = updatedItemStatus[itemIndex];
      const itemDesc = `${item.quantity}x ${item.burger_type} ${item.patty_size}`;
      const action = item.completed ? "completado" : "pendiente";
      toast({
        title: `Item ${action}`,
        description: `${itemDesc} marcado como ${action}`,
      });
    }
  };

  const markAsCompleted = async (orderId: string) => {
    const { error } = await supabase
      .from('orders')
      .update({ status: 'completed' })
      .eq('id', orderId);

    if (error) {
      console.error('Error updating order:', error);
      toast({
        title: "Error",
        description: "No se pudo marcar el pedido como completado",
        variant: "destructive"
      });
    } else {
      toast({
        title: "Pedido Completado",
        description: "El pedido ha sido marcado como listo"
      });
    }
  };

  const getOrderAge = (createdAt: string) => {
    const now = new Date();
    const orderTime = new Date(createdAt);
    const diffInMinutes = Math.floor((now.getTime() - orderTime.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 1) return { text: "Recién llegado", urgent: false };
    if (diffInMinutes < 15) return { text: `${diffInMinutes} min`, urgent: false };
    if (diffInMinutes < 30) return { text: `${diffInMinutes} min`, urgent: true };
    return { text: `${diffInMinutes} min`, urgent: true };
  };

  const printSingleOrder = (order: Order) => {
    const orderAge = getOrderAge(order.created_at);
    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Ticket Pedido - Roses Burgers</title>
          <style>
            body { 
              font-family: 'Courier New', monospace; 
              margin: 0; 
              padding: 10px;
              font-size: 12px;
              line-height: 1.2;
              width: 80mm;
              max-width: 300px;
            }
            .header { 
              text-align: center; 
              margin-bottom: 15px; 
              border-bottom: 1px dashed #000; 
              padding-bottom: 8px; 
            }
            .company-name { 
              font-weight: bold; 
              font-size: 14px; 
              margin-bottom: 3px; 
            }
            .ticket-info { 
              font-size: 10px; 
              margin-bottom: 10px; 
            }
            .order { 
              margin-bottom: 15px; 
              border-bottom: 1px dashed #000; 
              padding-bottom: 10px; 
            }
            .order-header { 
              font-weight: bold; 
              margin-bottom: 5px; 
              text-transform: uppercase;
            }
            .order-time { 
              font-size: 10px; 
              color: #666; 
            }
            .items { 
              margin: 8px 0; 
            }
            .item { 
              margin: 2px 0; 
              display: flex; 
              justify-content: space-between;
            }
            .item-name { 
              flex: 1; 
            }
            .item-qty { 
              margin-left: 10px; 
              font-weight: bold; 
            }
            .delivery { 
              background: #f8f8f8; 
              padding: 5px; 
              margin: 5px 0; 
              font-size: 11px;
              border: 1px solid #ddd;
            }
            .total { 
              font-weight: bold; 
              text-align: right; 
              margin-top: 5px;
              font-size: 13px;
            }
            .urgent { 
              background: #ffe6e6; 
              border: 1px solid #ff9999;
            }
            .footer {
              text-align: center;
              margin-top: 15px;
              padding-top: 8px;
              border-top: 1px dashed #000;
              font-size: 10px;
            }
            @media print {
              body { 
                margin: 0; 
                width: 80mm;
                font-size: 11px;
              }
              .order { 
                break-inside: avoid; 
              }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="company-name">ROSES BURGERS</div>
            <div>CUIT: 20-12345678-9</div>
            <div>IVA RESPONSABLE INSCRIPTO</div>
            <div class="ticket-info">
              TICKET COMANDA<br>
              ${new Date().toLocaleDateString('es-AR')} ${new Date().toLocaleTimeString('es-AR')}<br>
              NUEVO PEDIDO
            </div>
          </div>
          
          <div class="order ${orderAge.urgent ? 'urgent' : ''}">
            <div class="order-header">
              PEDIDO #${order.order_number} - ${order.nombre}
            </div>
            <div class="order-time">
              Tiempo: ${orderAge.text} ${orderAge.urgent ? '⚠️ URGENTE' : ''}
            </div>
            
            <div class="items">
                  ${order.item_status && order.item_status.length > 0 ? 
                    order.item_status.map((item, idx) => {
                      const additions = order.items?.[idx]?.additions && order.items[idx].additions!.length > 0 
                        ? ` (con ${order.items[idx].additions!.join(", ")})` 
                        : '';
                      const removals = order.items?.[idx]?.removals && order.items[idx].removals!.length > 0 
                        ? ` (sin ${order.items[idx].removals!.join(", ")})` 
                        : '';
                      const combo = item.combo ? " combo" : "";
                      return `<div class="item">
                        <span class="item-name">☐ ${item.burger_type} ${item.patty_size}${combo}${additions}${removals}</span>
                        <span class="item-qty">${item.quantity}x</span>
                      </div>`;
                    }).join('') :
                    order.items && order.items.length > 0 ?
                    order.items.map(item => {
                      const additions = item.additions && item.additions.length > 0 
                        ? ` (con ${item.additions.join(", ")})` 
                        : '';
                      const removals = item.removals && item.removals.length > 0 
                        ? ` (sin ${item.removals.join(", ")})` 
                        : '';
                      const combo = item.combo ? " combo" : "";
                      return `<div class="item">
                        <span class="item-name">${item.quantity}x ${item.burger_type} ${item.patty_size}${combo}${additions}${removals}</span>
                      </div>`;
                    }).join('') :
                    `<div class="item">
                      <span class="item-name">Sin items</span>
                    </div>`
                  }
            </div>
            
            <div class="delivery">
              <strong>ENTREGA:</strong><br>
              ${order.direccion_envio || 'RETIRO EN LOCAL'}
            </div>
            
            <div class="total">
              TOTAL: $${order.total}
            </div>
          </div>
          
          <div class="footer">
            DOCUMENTO NO VÁLIDO COMO FACTURA<br>
            COMANDA INTERNA DE COCINA<br>
            www.rosesburgers.com.ar
          </div>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    }
  };

  const printPendingOrders = () => {
    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Ticket Pedidos - Roses Burgers</title>
          <style>
            body { 
              font-family: 'Courier New', monospace; 
              margin: 0; 
              padding: 10px;
              font-size: 12px;
              line-height: 1.2;
              width: 80mm;
              max-width: 300px;
            }
            .header { 
              text-align: center; 
              margin-bottom: 15px; 
              border-bottom: 1px dashed #000; 
              padding-bottom: 8px; 
            }
            .company-name { 
              font-weight: bold; 
              font-size: 14px; 
              margin-bottom: 3px; 
            }
            .ticket-info { 
              font-size: 10px; 
              margin-bottom: 10px; 
            }
            .order { 
              margin-bottom: 15px; 
              border-bottom: 1px dashed #000; 
              padding-bottom: 10px; 
            }
            .order-header { 
              font-weight: bold; 
              margin-bottom: 5px; 
              text-transform: uppercase;
            }
            .order-time { 
              font-size: 10px; 
              color: #666; 
            }
            .items { 
              margin: 8px 0; 
            }
            .item { 
              margin: 2px 0; 
              display: flex; 
              justify-content: space-between;
            }
            .item-name { 
              flex: 1; 
            }
            .item-qty { 
              margin-left: 10px; 
              font-weight: bold; 
            }
            .delivery { 
              background: #f8f8f8; 
              padding: 5px; 
              margin: 5px 0; 
              font-size: 11px;
              border: 1px solid #ddd;
            }
            .total { 
              font-weight: bold; 
              text-align: right; 
              margin-top: 5px;
              font-size: 13px;
            }
            .urgent { 
              background: #ffe6e6; 
              border: 1px solid #ff9999;
            }
            .footer {
              text-align: center;
              margin-top: 15px;
              padding-top: 8px;
              border-top: 1px dashed #000;
              font-size: 10px;
            }
            @media print {
              body { 
                margin: 0; 
                width: 80mm;
                font-size: 11px;
              }
              .order { 
                break-inside: avoid; 
              }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="company-name">ROSES BURGERS</div>
            <div>CUIT: 20-12345678-9</div>
            <div>IVA RESPONSABLE INSCRIPTO</div>
            <div class="ticket-info">
              TICKET COMANDA<br>
              ${new Date().toLocaleDateString('es-AR')} ${new Date().toLocaleTimeString('es-AR')}<br>
              PEDIDOS PENDIENTES: ${pendingOrders.length}
            </div>
          </div>
          
          ${pendingOrders.map((order, index) => {
            const orderAge = getOrderAge(order.created_at);
            return `
              <div class="order ${orderAge.urgent ? 'urgent' : ''}">
                <div class="order-header">
                  PEDIDO #${order.order_number} - ${order.nombre}
                </div>
                <div class="order-time">
                  Tiempo: ${orderAge.text} ${orderAge.urgent ? '⚠️ URGENTE' : ''}
                </div>
                
                <div class="items">
                  ${order.item_status && order.item_status.length > 0 ? 
                    order.item_status.map((item, idx) => {
                      const additions = order.items?.[idx]?.additions && order.items[idx].additions!.length > 0 
                        ? ` (con ${order.items[idx].additions!.join(", ")})` 
                        : '';
                      const removals = order.items?.[idx]?.removals && order.items[idx].removals!.length > 0 
                        ? ` (sin ${order.items[idx].removals!.join(", ")})` 
                        : '';
                      const combo = item.combo ? " combo" : "";
                      return `<div class="item">
                        <span class="item-name">☐ ${item.burger_type} ${item.patty_size}${combo}${additions}${removals}</span>
                        <span class="item-qty">${item.quantity}x</span>
                      </div>`;
                    }).join('') :
                    order.items && order.items.length > 0 ?
                    order.items.map(item => {
                      const additions = item.additions && item.additions.length > 0 
                        ? ` (con ${item.additions.join(", ")})` 
                        : '';
                      const removals = item.removals && item.removals.length > 0 
                        ? ` (sin ${item.removals.join(", ")})` 
                        : '';
                      const combo = item.combo ? " combo" : "";
                      return `<div class="item">
                        <span class="item-name">${item.quantity}x ${item.burger_type} ${item.patty_size}${combo}${additions}${removals}</span>
                      </div>`;
                    }).join('') :
                    `<div class="item">
                      <span class="item-name">Sin items</span>
                    </div>`
                  }
                </div>
                
                <div class="delivery">
                  <strong>ENTREGA:</strong><br>
                  ${order.direccion_envio || 'RETIRO EN LOCAL'}
                </div>
                
                <div class="total">
                  TOTAL: $${order.total}
                </div>
              </div>
            `;
          }).join('')}
          
          <div class="footer">
            DOCUMENTO NO VÁLIDO COMO FACTURA<br>
            COMANDA INTERNA DE COCINA<br>
            www.rosesburgers.com.ar
          </div>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    }
  };

  const OrderCard = ({ order, showCompleteButton = true }: { order: Order; showCompleteButton?: boolean }) => {
    const orderAge = getOrderAge(order.created_at);
    
    return (
      <Card 
        className={`transition-all duration-500 hover:shadow-lg animate-in fade-in-0 slide-in-from-top-4 ${
          orderAge.urgent && showCompleteButton
            ? 'border-kitchen-urgent shadow-md' 
            : 'border-border'
        }`}
        style={{
          animationDelay: `${Math.random() * 500}ms`
        }}
      >
        <CardHeader className="pb-3">
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-lg">{order.nombre}</CardTitle>
              <Badge variant="secondary" className="text-xs mt-1">
                Pedido #{order.order_number}
              </Badge>
            </div>
            <div className="flex flex-col gap-2 items-end">
              {showCompleteButton && (
                <Badge 
                  variant={orderAge.urgent ? "destructive" : "secondary"}
                  className="text-xs"
                >
                  <Clock className="w-3 h-3 mr-1" />
                  {orderAge.text}
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">
                <DollarSign className="w-3 h-3 mr-1" />
                ${order.total}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Show items TO-DO list if parsed and this is a pending order, otherwise show full pedido */}
          {order.item_status && order.item_status.length > 0 && showCompleteButton ? (
            <div className="bg-muted p-3 rounded-md">
              <p className="font-medium text-sm text-muted-foreground mb-3">
                📋 TO-DO Items:
              </p>
              <div className="space-y-2">
                {order.item_status.map((item, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <Button
                      variant={item.completed ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleItemCompleted(order.id, index)}
                      className={`flex items-center gap-2 ${
                        item.completed 
                          ? "bg-success text-success-foreground hover:bg-success/90" 
                          : "hover:bg-muted-foreground/10"
                      }`}
                     >
                       <Check className={`w-3 h-3 ${item.completed ? "opacity-100" : "opacity-30"}`} />
                       <span className={`text-xs ${item.completed ? "line-through" : ""}`}>
                         {item.quantity}x {item.burger_type} {item.patty_size} {item.combo ? "combo" : ""}
                         {order.items?.[index]?.additions && order.items[index].additions!.length > 0 && 
                           ` (con ${order.items[index].additions!.join(", ")})`
                         }
                         {order.items?.[index]?.removals && order.items[index].removals!.length > 0 && 
                           ` (sin ${order.items[index].removals!.join(", ")})`
                         }
                       </span>
                     </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : order.items && order.items.length > 0 ? (
            <div className="bg-muted p-3 rounded-md">
              <p className="font-medium text-sm text-muted-foreground mb-2">
                Items del Pedido:
              </p>
              <div className="space-y-2">
                {order.items.map((item, index) => (
                  <div key={index} className="text-sm font-medium text-foreground">
                    {item.quantity}x {item.burger_type} {item.patty_size} {item.combo ? "combo" : ""}
                    {item.additions && item.additions.length > 0 && ` (con ${item.additions.join(", ")})`}
                    {item.removals && item.removals.length > 0 && ` (sin ${item.removals.join(", ")})`}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-muted p-3 rounded-md">
              <p className="font-medium text-sm text-muted-foreground mb-1">
                Sin detalles
              </p>
            </div>
          )}

          {/* DOMICILIO section */}
          <div className="bg-blue-50 border border-blue-200 p-3 rounded-md">
            <p className="font-medium text-sm text-blue-700 mb-1">
              🏠 DOMICILIO:
            </p>
            <p className="text-blue-900 text-sm">
              {order.direccion_envio || "Sin dirección de envío especificada"}
            </p>
          </div>
          
          <div className="text-xs text-muted-foreground">
            {showCompleteButton ? 'Recibido' : 'Completado'}: {formatDistance(new Date(order.created_at), new Date(), { 
              addSuffix: true, 
              locale: es 
            })}
          </div>

          {showCompleteButton && (
            <Button 
              onClick={() => markAsCompleted(order.id)}
              className="w-full bg-success hover:bg-success/90 text-success-foreground"
              size="lg"
            >
              <Check className="w-4 h-4 mr-2" />
              Hecho
            </Button>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-4 mb-4">
            <img 
              src="/lovable-uploads/86ac5a9c-d0bd-40ac-88b0-07fc04f59e14.png" 
              alt="Roses Burgers Logo" 
              className="h-16 w-auto"
            />
            <h1 className="text-5xl font-bold text-foreground">
              ROSES BURGERS
            </h1>
          </div>
          <p className="text-xl text-muted-foreground mb-6">
            Sistema de gestión de pedidos en tiempo real
          </p>
        </div>

        <Tabs defaultValue="pending" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="pending" className="flex items-center gap-2">
              <ChefHat className="w-4 h-4" />
              Pedidos Pendientes ({pendingOrders.length})
            </TabsTrigger>
            <TabsTrigger value="completed" className="flex items-center gap-2">
              <Check className="w-4 h-4" />
              Pedidos Completados ({completedOrders.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending">
            {pendingOrders.length === 0 ? (
              <Card className="text-center py-12">
                <CardContent>
                  <Clock className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
                  <h3 className="text-xl font-semibold mb-2">No hay pedidos pendientes</h3>
                  <p className="text-muted-foreground">
                    Los nuevos pedidos aparecerán aquí automáticamente
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <Button 
                    onClick={printPendingOrders}
                    variant="outline"
                    className="flex items-center gap-2"
                  >
                    <Printer className="w-4 h-4" />
                    Imprimir Pedidos
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pendingOrders.map((order) => (
                    <OrderCard key={order.id} order={order} />
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="completed">
            {completedOrders.length === 0 ? (
              <Card className="text-center py-12">
                <CardContent>
                  <Check className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
                  <h3 className="text-xl font-semibold mb-2">No hay pedidos completados</h3>
                  <p className="text-muted-foreground">
                    Los pedidos marcados como hechos aparecerán aquí
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {completedOrders.map((order) => (
                  <OrderCard key={order.id} order={order} showCompleteButton={false} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Index;
