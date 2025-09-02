import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChefHat, BarChart3, ExternalLink } from "lucide-react";

const Index = () => {
  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold mb-4 text-foreground">
            🍔 Dashboard Hamburguesería
          </h1>
          <p className="text-xl text-muted-foreground mb-6">
            Sistema de gestión de pedidos para cocina
          </p>
          <Badge variant="outline" className="text-lg px-4 py-2">
            Sistema integrado con n8n y WhatsApp
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-2xl">
                <ChefHat className="h-8 w-8 text-primary" />
                Dashboard de Cocina
              </CardTitle>
              <p className="text-muted-foreground">
                Vista en tiempo real de pedidos pendientes. Ideal para pantalla en cocina.
              </p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 mb-4 text-sm">
                <li>• Pedidos en tiempo real desde WhatsApp</li>
                <li>• Notificaciones automáticas</li>
                <li>• Botón "Listo" para completar pedidos</li>
                <li>• Indicadores de tiempo urgente</li>
              </ul>
              <Link to="/kitchen">
                <Button className="w-full" size="lg">
                  Ir a Cocina
                  <ExternalLink className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-2xl">
                <BarChart3 className="h-8 w-8 text-primary" />
                Análisis y Reportes
              </CardTitle>
              <p className="text-muted-foreground">
                Estadísticas de ventas, productos más vendidos y análisis de clientes.
              </p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 mb-4 text-sm">
                <li>• Historial completo de pedidos</li>
                <li>• Productos más vendidos</li>
                <li>• Análisis de clientes frecuentes</li>
                <li>• Métricas de ingresos</li>
              </ul>
              <Link to="/analytics">
                <Button variant="outline" className="w-full" size="lg">
                  Ver Análisis
                  <ExternalLink className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-xl">🔗 URL para n8n</CardTitle>
            <p className="text-muted-foreground">
              Usa esta URL en tu webhook de n8n para enviar pedidos desde WhatsApp
            </p>
          </CardHeader>
          <CardContent>
            <div className="bg-muted p-4 rounded-md font-mono text-sm break-all">
              https://hdizvbyvtlmkwprhdnzr.supabase.co/functions/v1/receive-order
            </div>
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium">Formato JSON requerido:</p>
              <div className="bg-muted p-3 rounded-md text-xs">
                <pre>{`{
  "nombre": "Juan Pérez",
  "pedido": "Hamburguesa completa, Papas fritas",
  "monto": 15.50
}`}</pre>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="text-center text-sm text-muted-foreground">
          <p>Recibe pedidos por WhatsApp → n8n → Dashboard de Cocina</p>
        </div>
      </div>
    </div>
  );
};

export default Index;
