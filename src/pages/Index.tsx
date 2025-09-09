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
  name: string;
}

interface ItemStatus {
  name: string;
  quantity: number;
  completed: boolean;
}

interface Order {
  id: string;
  nombre: string;
  pedido: string;
  total: number;
  fecha: string;
  status: string;
  created_at: string;
  items?: OrderItem[];
  item_status?: ItemStatus[];
  direccion_envio?: string;
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
              setPendingOrders(prev => [newOrder, ...prev]);
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
      
      const itemName = updatedItemStatus[itemIndex].name;
      const action = updatedItemStatus[itemIndex].completed ? "completado" : "pendiente";
      toast({
        title: `Item ${action}`,
        description: `${itemName} marcado como ${action}`,
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

  const printPendingOrders = () => {
    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Pedidos Pendientes - Roses Burgers</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #000; padding-bottom: 10px; }
            .order { margin-bottom: 20px; border: 1px solid #333; padding: 15px; page-break-inside: avoid; }
            .order-header { font-weight: bold; font-size: 16px; margin-bottom: 10px; }
            .order-items { margin: 10px 0; }
            .item { margin: 5px 0; padding: 3px 0; }
            .delivery { background: #f0f0f0; padding: 10px; margin: 10px 0; border-left: 4px solid #333; }
            .total { font-weight: bold; font-size: 18px; text-align: right; }
            .urgent { border-color: #ff0000; background: #fff5f5; }
            @media print {
              body { margin: 0; }
              .order { break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>ROSES BURGERS</h1>
            <h2>Pedidos Pendientes</h2>
            <p>Fecha: ${new Date().toLocaleDateString('es-AR')} - ${new Date().toLocaleTimeString('es-AR')}</p>
          </div>
          ${pendingOrders.map(order => {
            const orderAge = getOrderAge(order.created_at);
            return `
              <div class="order ${orderAge.urgent ? 'urgent' : ''}">
                <div class="order-header">
                  Cliente: ${order.nombre} - Total: $${order.total} - Tiempo: ${orderAge.text}
                </div>
                <div class="order-items">
                  ${order.item_status && order.item_status.length > 0 ? 
                    order.item_status.map(item => 
                      `<div class="item">☐ ${item.quantity}x ${item.name}</div>`
                    ).join('') :
                    `<div class="item">${order.pedido}</div>`
                  }
                </div>
                <div class="delivery">
                  <strong>Dirección:</strong> ${order.direccion_envio || 'Sin dirección especificada'}
                </div>
              </div>
            `;
          }).join('')}
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
            <CardTitle className="text-lg">{order.nombre}</CardTitle>
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
                        {item.quantity}x {item.name}
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
              <div className="space-y-1">
                {order.items.map((item, index) => (
                  <div key={index} className="flex justify-between text-sm">
                    <span className="text-foreground">
                      {item.quantity}x {item.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-muted p-3 rounded-md">
              <p className="font-medium text-sm text-muted-foreground mb-1">
                Pedido:
              </p>
              <p className="text-foreground whitespace-pre-wrap">
                {order.pedido}
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
