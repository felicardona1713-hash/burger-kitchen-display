import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { formatDistance } from "date-fns";
import { es } from "date-fns/locale";
import { Check, Clock, DollarSign, ChefHat } from "lucide-react";

interface Order {
  id: string;
  nombre: string;
  pedido: string;
  total: number;
  fecha: string;
  status: string;
  created_at: string;
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
      else setPendingOrders(pending || []);
      
      if (completedError) console.error('Error fetching completed orders:', completedError);
      else setCompletedOrders(completed || []);
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
          <div className="bg-muted p-3 rounded-md">
            <p className="font-medium text-sm text-muted-foreground mb-1">
              Pedido:
            </p>
            <p className="text-foreground whitespace-pre-wrap">
              {order.pedido}
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {pendingOrders.map((order) => (
                  <OrderCard key={order.id} order={order} />
                ))}
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
