import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { formatDistance } from "date-fns";
import { es } from "date-fns/locale";
import { Check, Clock, DollarSign } from "lucide-react";

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
  order_number: number;
  nombre: string;
  monto: number;
  fecha: string;
  status: string;
  created_at: string;
  items?: OrderItem[];
  item_status?: ItemStatus[];
  direccion_envio?: string;
  metodo_pago?: string;
}

const Kitchen = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    // Fetch initial pending orders
    const fetchOrders = async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      
      if (error) {
        console.error('Error fetching orders:', error);
      } else {
        const typedOrders = (data || []).map(order => ({
          ...order,
          items: Array.isArray(order.items) ? order.items as unknown as OrderItem[] : undefined,
          item_status: Array.isArray(order.item_status) ? order.item_status as unknown as ItemStatus[] : undefined
        }));
        setOrders(typedOrders);
      }
    };

    fetchOrders();

    // Subscribe to real-time changes
    const channel = supabase
      .channel('kitchen-orders')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'orders'
        },
        (payload) => {
          console.log('Order INSERT:', payload);
          const newOrder = payload.new as Order;
          if (newOrder.status === 'pending') {
            setOrders(prev => [...prev, newOrder]);
            const itemsDesc = newOrder.items?.map(i => `${i.quantity}x ${i.burger_type}`).join(', ') || '';
            toast({
              title: "¡Nuevo Pedido!",
              description: `${newOrder.nombre} - ${itemsDesc}`,
              duration: 5000,
            });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders'
        },
        (payload) => {
          console.log('Order UPDATE:', payload);
          const updatedOrder = {
            ...payload.new as Order,
            items: Array.isArray((payload.new as any).items) ? (payload.new as any).items as unknown as OrderItem[] : undefined,
            item_status: Array.isArray((payload.new as any).item_status) ? (payload.new as any).item_status as unknown as ItemStatus[] : undefined
          };
          if (updatedOrder.status === 'completed') {
            setOrders(prev => prev.filter(order => order.id !== updatedOrder.id));
          } else if (updatedOrder.status === 'pending') {
            setOrders(prev => prev.map(order => 
              order.id === updatedOrder.id ? updatedOrder : order
            ));
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'orders'
        },
        (payload) => {
          console.log('Order DELETE:', payload);
          const deletedOrder = payload.old as Order;
          setOrders(prev => prev.filter(order => order.id !== deletedOrder.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [toast]);

  const toggleItemCompleted = async (orderId: string, itemIndex: number) => {
    const order = orders.find(o => o.id === orderId);
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
      setOrders(prev => prev.map(o => 
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
        description: "El pedido ha sido marcado como listo",
        variant: "default"
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

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-4xl font-bold text-foreground mb-2">
            🍔 Dashboard de Cocina
          </h1>
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="text-lg px-3 py-1">
              {orders.length} pedidos pendientes
            </Badge>
            <Badge variant="secondary" className="text-lg px-3 py-1">
              {new Date().toLocaleDateString('es-ES')}
            </Badge>
          </div>
        </div>

        {orders.length === 0 ? (
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {orders.map((order) => {
              const orderAge = getOrderAge(order.created_at);
              return (
                <Card 
                  key={order.id} 
                  className={`transition-all duration-300 hover:shadow-lg ${
                    orderAge.urgent 
                      ? 'border-kitchen-urgent shadow-md' 
                      : 'border-border'
                  }`}
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
                        <Badge 
                          variant={orderAge.urgent ? "destructive" : "secondary"}
                          className="text-xs"
                        >
                          <Clock className="w-3 h-3 mr-1" />
                          {orderAge.text}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          <DollarSign className="w-3 h-3 mr-1" />
                          ${order.monto}
                        </Badge>
                        <Badge 
                          variant={order.metodo_pago === 'transferencia' ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          {order.metodo_pago === 'transferencia' ? '💳' : '💵'} {order.metodo_pago || 'efectivo'}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                   <CardContent className="space-y-4">
                     {/* Show delivery address if available */}
                     {order.direccion_envio && (
                       <div className="bg-blue-50 border border-blue-200 p-3 rounded-md">
                         <p className="font-medium text-sm text-blue-700 mb-1">
                           🚚 Dirección de Envío:
                         </p>
                         <p className="text-blue-900 text-sm">
                           {order.direccion_envio}
                         </p>
                       </div>
                     )}

                      {/* Show items TO-DO list if parsed, otherwise show full pedido */}
                      {order.item_status && order.item_status.length > 0 ? (
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
                     
                     <div className="text-xs text-muted-foreground">
                       Recibido: {formatDistance(new Date(order.created_at), new Date(), { 
                         addSuffix: true, 
                         locale: es 
                       })}
                     </div>

                    <Button 
                      onClick={() => markAsCompleted(order.id)}
                      className="w-full bg-success hover:bg-success/90 text-success-foreground"
                      size="lg"
                    >
                      <Check className="w-4 h-4 mr-2" />
                      Marcar como Listo
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Kitchen;