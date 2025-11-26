import { Link, useLocation } from "react-router-dom";
import { Home, ChefHat, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

const Navbar = () => {
  const location = useLocation();

  const links = [
    { path: "/", label: "Pedidos", icon: Home },
    { path: "/kitchen", label: "Cocina", icon: ChefHat },
    { path: "/analytics", label: "Analytics", icon: BarChart3 },
  ];

  return (
    <nav className="bg-background border-b border-border mb-6">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-foreground">Roses Burgers</span>
          </div>
          <div className="flex gap-1">
            {links.map(({ path, label, icon: Icon }) => (
              <Link
                key={path}
                to={path}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
                  location.pathname === path
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
