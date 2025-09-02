import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDistance } from "date-fns";
import { es } from "date-fns/locale";
import { TrendingUp, DollarSign, ShoppingBag, Users } from "lucide-react";

interface Order {
  id: string;
  nombre: string;
  pedido: string;
  total: number;
  fecha: string;
  status: string;
  created_at: string;
}

interface ProductStats {
  producto: string;
  cantidad: number;
  ingresos: number;
}

interface CustomerStats {
  cliente: string;
  totalPedidos: number;
  totalGastado: number;
}

const Analytics = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [productStats, setProductStats] = useState<ProductStats[]>([]);
  const [customerStats, setCustomerStats] = useState<CustomerStats[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalOrders, setTotalOrders] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      // Fetch all orders
      const { data: ordersData, error } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching orders:', error);
        return;
      }

      const allOrders = ordersData || [];
      setOrders(allOrders);
      setTotalOrders(allOrders.length);
      setTotalRevenue(allOrders.reduce((sum, order) => sum + Number(order.total), 0));

      // Analyze products
      const productMap = new Map<string, { cantidad: number; ingresos: number }>();
      
      allOrders.forEach(order => {
        const productos = order.pedido.split(',').map(p => p.trim());
        productos.forEach(producto => {
          if (producto) {
            const current = productMap.get(producto) || { cantidad: 0, ingresos: 0 };
            productMap.set(producto, {
              cantidad: current.cantidad + 1,
              ingresos: current.ingresos + Number(order.total) / productos.length
            });
          }
        });
      });

      const sortedProducts = Array.from(productMap.entries())
        .map(([producto, stats]) => ({ producto, ...stats }))
        .sort((a, b) => b.cantidad - a.cantidad);
      
      setProductStats(sortedProducts);

      // Analyze customers
      const customerMap = new Map<string, { totalPedidos: number; totalGastado: number }>();
      
      allOrders.forEach(order => {
        const current = customerMap.get(order.nombre) || { totalPedidos: 0, totalGastado: 0 };
        customerMap.set(order.nombre, {
          totalPedidos: current.totalPedidos + 1,
          totalGastado: current.totalGastado + Number(order.total)
        });
      });

      const sortedCustomers = Array.from(customerMap.entries())
        .map(([cliente, stats]) => ({ cliente, ...stats }))
        .sort((a, b) => b.totalGastado - a.totalGastado);
      
      setCustomerStats(sortedCustomers);
    };

    fetchData();
  }, []);

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="mb-6">
          <h1 className="text-4xl font-bold text-foreground mb-2">
            📊 Análisis de Ventas
          </h1>
          <p className="text-muted-foreground">
            Estadísticas y análisis de todos los pedidos
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Pedidos</CardTitle>
              <ShoppingBag className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalOrders}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Ingresos Totales</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${totalRevenue.toFixed(2)}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Clientes Únicos</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{customerStats.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Promedio por Pedido</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : '0.00'}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Products */}
          <Card>
            <CardHeader>
              <CardTitle>Productos Más Vendidos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {productStats.slice(0, 5).map((product, index) => (
                  <div key={product.producto} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary" className="w-8 h-8 rounded-full flex items-center justify-center">
                        {index + 1}
                      </Badge>
                      <div>
                        <p className="font-medium">{product.producto}</p>
                        <p className="text-sm text-muted-foreground">
                          ${product.ingresos.toFixed(2)} en ingresos
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline">
                      {product.cantidad} vendidos
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Top Customers */}
          <Card>
            <CardHeader>
              <CardTitle>Mejores Clientes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {customerStats.slice(0, 5).map((customer, index) => (
                  <div key={customer.cliente} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary" className="w-8 h-8 rounded-full flex items-center justify-center">
                        {index + 1}
                      </Badge>
                      <div>
                        <p className="font-medium">{customer.cliente}</p>
                        <p className="text-sm text-muted-foreground">
                          {customer.totalPedidos} pedidos
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline">
                      ${customer.totalGastado.toFixed(2)}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Orders Table */}
        <Card>
          <CardHeader>
            <CardTitle>Historial de Pedidos</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.slice(0, 20).map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.nombre}</TableCell>
                    <TableCell className="max-w-xs truncate">{order.pedido}</TableCell>
                    <TableCell>${order.total}</TableCell>
                    <TableCell>
                      <Badge 
                        variant={order.status === 'completed' ? 'default' : 'secondary'}
                      >
                        {order.status === 'completed' ? 'Completado' : 'Pendiente'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDistance(new Date(order.created_at), new Date(), { 
                        addSuffix: true, 
                        locale: es 
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Analytics;