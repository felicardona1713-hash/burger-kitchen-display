import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, LineChart, Line } from "recharts";
import { formatDistance, startOfWeek, startOfMonth, format } from "date-fns";
import { es } from "date-fns/locale";
import { TrendingUp, DollarSign, ShoppingBag, Users } from "lucide-react";

interface OrderItem {
  quantity: number;
  burger_type: string;
  patty_size: string;
  combo: boolean;
  additions?: string[] | null;
  removals?: string[] | null;
}

interface Order {
  id: string;
  nombre: string;
  telefono?: string | null;
  items?: OrderItem[];
  total: number;
  fecha: string;
  status: string;
  created_at: string;
}

interface ProductStats {
  producto: string;
  pattySize: string;
  combo: boolean;
  cantidad: number;
  ingresos: number;
}

interface CustomerStats {
  cliente: string;
  totalPedidos: number;
  totalGastado: number;
}

interface RevenueData {
  period: string;
  ingresos: number;
}

const Analytics = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [productStats, setProductStats] = useState<ProductStats[]>([]);
  const [customerStats, setCustomerStats] = useState<CustomerStats[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalOrders, setTotalOrders] = useState(0);
  const [monthlyRevenue, setMonthlyRevenue] = useState<RevenueData[]>([]);
  const [weeklyRevenue, setWeeklyRevenue] = useState<RevenueData[]>([]);

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

      const allOrders = (ordersData || []).map(order => ({
        ...order,
        items: Array.isArray(order.items) ? order.items as unknown as OrderItem[] : undefined
      }));
      setOrders(allOrders);
      setTotalOrders(allOrders.length);
      setTotalRevenue(allOrders.reduce((sum, order) => sum + Number(order.total), 0));

      // Analyze products from items array - group by burger_type + patty_size + combo
      const productMap = new Map<string, { cantidad: number; ingresos: number; producto: string; pattySize: string; combo: boolean }>();
      
      allOrders.forEach(order => {
        if (order.items && Array.isArray(order.items)) {
          order.items.forEach(item => {
            // Skip items without burger_type
            if (!item.burger_type) return;
            
            const burgerType = item.burger_type.trim();
            const pattySize = item.patty_size || 'simple';
            const isCombo = item.combo || false;
            
            // Create unique key combining all attributes
            const key = `${burgerType}-${pattySize}-${isCombo}`;
            
            const current = productMap.get(key) || { 
              cantidad: 0, 
              ingresos: 0,
              producto: burgerType,
              pattySize: pattySize,
              combo: isCombo
            };
            
            const itemRevenue = Number(order.total) / order.items.length;
            
            productMap.set(key, {
              ...current,
              cantidad: current.cantidad + (item.quantity || 1),
              ingresos: current.ingresos + itemRevenue
            });
          });
        }
      });

      const sortedProducts = Array.from(productMap.values())
        .sort((a, b) => b.cantidad - a.cantidad);
      
      setProductStats(sortedProducts);

      // Analyze customers - group by phone number
      const customerMap = new Map<string, { totalPedidos: number; totalGastado: number }>();
      
      allOrders.forEach(order => {
        // Use phone number as the key, fallback to "Sin teléfono" if not available
        const clienteKey = order.telefono || "Sin teléfono";
        
        const current = customerMap.get(clienteKey) || { totalPedidos: 0, totalGastado: 0 };
        customerMap.set(clienteKey, {
          totalPedidos: current.totalPedidos + 1,
          totalGastado: current.totalGastado + Number(order.total)
        });
      });

      const sortedCustomers = Array.from(customerMap.entries())
        .map(([cliente, stats]) => ({ cliente, ...stats }))
        .sort((a, b) => b.totalGastado - a.totalGastado);
      
      setCustomerStats(sortedCustomers);

      // Analyze monthly revenue
      const monthlyMap = new Map<string, number>();
      const weeklyMap = new Map<string, number>();
      
      allOrders.forEach(order => {
        const date = new Date(order.created_at);
        const monthKey = format(startOfMonth(date), 'MMM yyyy', { locale: es });
        const weekKey = format(startOfWeek(date, { weekStartsOn: 1 }), 'dd MMM', { locale: es });
        
        monthlyMap.set(monthKey, (monthlyMap.get(monthKey) || 0) + Number(order.total));
        weeklyMap.set(weekKey, (weeklyMap.get(weekKey) || 0) + Number(order.total));
      });

      const monthlyData = Array.from(monthlyMap.entries())
        .map(([period, ingresos]) => ({ period, ingresos }))
        .sort((a, b) => new Date(a.period).getTime() - new Date(b.period).getTime());
      
      const weeklyData = Array.from(weeklyMap.entries())
        .map(([period, ingresos]) => ({ period, ingresos }))
        .slice(-8); // Last 8 weeks
      
      setMonthlyRevenue(monthlyData);
      setWeeklyRevenue(weeklyData);
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

        {/* Revenue Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Ingresos por Mes</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer
                config={{
                  ingresos: {
                    label: "Ingresos",
                    color: "hsl(var(--primary))",
                  },
                }}
                className="h-[300px]"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyRevenue}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="period" />
                    <YAxis />
                    <ChartTooltip 
                      content={<ChartTooltipContent />}
                      formatter={(value) => [`$${Number(value).toFixed(2)}`, "Ingresos"]}
                    />
                    <Bar dataKey="ingresos" fill="var(--color-ingresos)" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ingresos por Semana</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer
                config={{
                  ingresos: {
                    label: "Ingresos",
                    color: "hsl(var(--primary))",
                  },
                }}
                className="h-[300px]"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weeklyRevenue}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="period" />
                    <YAxis />
                    <ChartTooltip 
                      content={<ChartTooltipContent />}
                      formatter={(value) => [`$${Number(value).toFixed(2)}`, "Ingresos"]}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="ingresos" 
                      stroke="var(--color-ingresos)" 
                      strokeWidth={2}
                      dot={{ fill: "var(--color-ingresos)" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartContainer>
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
                  <div key={`${product.producto}-${product.pattySize}-${product.combo}`} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary" className="w-8 h-8 rounded-full flex items-center justify-center">
                        {index + 1}
                      </Badge>
                      <div>
                        <p className="font-medium">
                          {product.producto} - {product.pattySize}
                          {product.combo && ' 🍟'}
                        </p>
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
                  <TableHead>Items</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.slice(0, 20).map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.nombre}</TableCell>
                    <TableCell className="max-w-xs">
                      {order.items?.map((item, idx) => (
                        <div key={idx} className="text-sm">
                          {item.quantity}x {item.burger_type} {item.patty_size}
                          {item.combo && ' (combo)'}
                        </div>
                      ))}
                    </TableCell>
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