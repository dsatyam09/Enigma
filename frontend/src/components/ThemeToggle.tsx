import { Moon, Sun } from "lucide-react";
import { motion } from "framer-motion";
import { useTheme } from "@/context/ThemeContext";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="relative flex items-center w-14 h-7 rounded-full p-0.5 transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary/70 focus-visible:ring-offset-background dark:border dark:border-border/80"
      style={{ backgroundColor: dark ? "hsl(var(--secondary))" : "#e2e8f0" }}
    >
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 500, damping: 35 }}
        className="flex items-center justify-center w-6 h-6 rounded-full bg-white shadow-sm dark:border dark:border-white/10"
        style={{ marginLeft: dark ? "auto" : 0 }}
      >
        {dark
          ? <Moon className="w-3.5 h-3.5 text-primary" />
          : <Sun className="w-3.5 h-3.5 text-amber-500" />
        }
      </motion.div>
    </button>
  );
}
