import type { ComponentType, ReactNode } from "react";

/* ─────────────────────────── Severity ─────────────────────────── */

export type Severity = "critical" | "high" | "medium" | "low" | "info";

/**
 * findings.triage_score is a 0.0–1.0 FLOAT. `high` starts at 0.7 to match the
 * /api/metrics "highSeverity" threshold (COUNT WHERE triage_score >= 0.7).
 * Single source of truth for score → severity across the whole app.
 */
export function severityFromScore(score: number | null | undefined): Severity {
  const s = typeof score === "number" && Number.isFinite(score) ? score : 0;
  if (s >= 0.9) return "critical";
  if (s >= 0.7) return "high";
  if (s >= 0.4) return "medium";
  if (s >= 0.15) return "low";
  return "info";
}

const SEVERITY_CLS: Record<
  Severity,
  { label: string; text: string; bg: string; border: string; dot: string }
> = {
  critical: { label: "Critical", text: "text-critical", bg: "bg-critical/12", border: "border-critical/40", dot: "bg-critical" },
  high: { label: "High", text: "text-high", bg: "bg-high/12", border: "border-high/40", dot: "bg-high" },
  medium: { label: "Medium", text: "text-medium", bg: "bg-medium/12", border: "border-medium/40", dot: "bg-medium" },
  low: { label: "Low", text: "text-low", bg: "bg-low/12", border: "border-low/40", dot: "bg-low" },
  info: { label: "Info", text: "text-info", bg: "bg-info/12", border: "border-info/40", dot: "bg-info" },
};

export function SeverityPill({
  severity,
  className = "",
  children,
}: {
  severity: Severity;
  className?: string;
  children?: ReactNode;
}) {
  const m = SEVERITY_CLS[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${m.bg} ${m.border} ${m.text} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} aria-hidden="true" />
      {children ?? m.label}
    </span>
  );
}

/* ─────────────────────────── Status ─────────────────────────── */

const STATUS_CLS: Record<string, string> = {
  active: "text-success bg-success/12 border-success/40",
  running: "text-accent bg-accent/12 border-accent/40",
  done: "text-success bg-success/12 border-success/40",
  completed: "text-success bg-success/12 border-success/40",
  accepted: "text-success bg-success/12 border-success/40",
  submitted: "text-accent bg-accent/12 border-accent/40",
  pending: "text-warning bg-warning/12 border-warning/40",
  queued: "text-warning bg-warning/12 border-warning/40",
  draft: "text-subtle bg-surface-2 border-border-strong",
  informative: "text-info bg-info/12 border-info/40",
  rejected: "text-danger bg-danger/12 border-danger/40",
  failed: "text-danger bg-danger/12 border-danger/40",
  inactive: "text-subtle bg-surface-2 border-border-strong",
};

export function StatusPill({
  status,
  className = "",
}: {
  status: string | null | undefined;
  className?: string;
}) {
  const key = (status || "").toLowerCase();
  const cls = STATUS_CLS[key] || "text-muted-foreground bg-surface-2 border-border-strong";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${cls} ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden="true" />
      {status || "unknown"}
    </span>
  );
}

/* ─────────────────────────── Layout bits ─────────────────────────── */

type IconType = ComponentType<{ className?: string }>;

export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
}: {
  title: string;
  description?: string;
  icon?: IconType;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        {Icon && (
          <span className="mt-0.5 hidden rounded-lg border border-border bg-surface p-2 text-accent sm:inline-flex">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: IconType;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong bg-surface/40 px-6 py-16 text-center">
      {Icon && <Icon className="mb-3 h-8 w-8 text-subtle" />}
      <p className="text-base font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "accent",
  loading = false,
  trend,
  trendLabel,
  description,
}: {
  label: string;
  value: ReactNode;
  icon: IconType;
  tone?: "accent" | "danger" | "success" | "warning";
  loading?: boolean;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  description?: string;
}) {
  const tones: Record<string, string> = {
    accent: "text-accent bg-accent/12",
    danger: "text-danger bg-danger/12",
    success: "text-success bg-success/12",
    warning: "text-warning bg-warning/12",
  };
  return (
    <div className="card flex items-center gap-4 p-5">
      <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm text-muted-foreground">{label}</p>
        {loading ? (
          <Skeleton className="mt-1.5 h-7 w-16" />
        ) : (
          <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
        )}
        {trendLabel && (
          <p className={`mt-0.5 text-xs ${trend === "up" ? "text-success" : trend === "down" ? "text-danger" : "text-muted-foreground"}`}>{trendLabel}</p>
        )}
        {description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Button ─────────────────────────── */

export function Button({
  children,
  variant = "default",
  size = "md",
  className = "",
  disabled = false,
  loading = false,
  type = "button",
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
}) {
  const base = "inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    default: "bg-accent text-white hover:bg-accent/90",
    outline: "border border-border bg-surface-2 hover:bg-surface-3 text-foreground",
    ghost: "hover:bg-surface-2 text-foreground",
    destructive: "bg-red-500 text-white hover:bg-red-600",
  };
  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base",
    icon: "p-2",
  };
  return (
    <button
      type={type}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      onClick={onClick}
      {...props}
    >
      {loading && <span className="animate-spin">⏳</span>}
      {children}
    </button>
  );
}

export function IconButton({
  children,
  variant = "ghost",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg" | "icon";
}) {
  return <Button variant={variant} size={size} className={className} {...props}>{children}</Button>;
}

/* ─────────────────────────── Input ─────────────────────────── */

export function Input({
  className = "",
  type = "text",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={`w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-foreground outline-none focus:border-accent placeholder:text-muted-foreground ${className}`}
      {...props}
    />
  );
}

export function Textarea({
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-foreground outline-none focus:border-accent placeholder:text-muted-foreground ${className}`}
      {...props}
    />
  );
}

/* ─────────────────────────── Label ─────────────────────────── */

export function Label({
  children,
  className = "",
  htmlFor,
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label htmlFor={htmlFor} className={`block text-sm font-medium text-foreground ${className}`}>
      {children}
    </label>
  );
}

/* ─────────────────────────── Select ─────────────────────────── */

export function Select({
  children,
  value,
  onValueChange,
  className = "",
}: {
  children: React.ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger className="w-full">{SelectPrimitive.Value}</SelectPrimitive.Trigger>
      <SelectPrimitive.Content className="relative z-50">{children}</SelectPrimitive.Content>
    </SelectPrimitive.Root>
  );
}

// Simplified select primitives for compatibility
const SelectPrimitive = {
  Root: ({ children, value, onValueChange }: any) => (
    <select
      value={value}
      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onValueChange(e.target.value)}
      className="w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
    >
      {children}
    </select>
  ),
  Trigger: ({ children }: any) => <span>{children}</span>,
  Value: ({ children }: any) => <span>{children}</span>,
  Content: ({ children }: any) => <div>{children}</div>,
  Item: ({ children, value, disabled }: any) => (
    <option value={value} disabled={disabled}>{children}</option>
  ),
};

export function SelectTrigger({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

export function SelectValue({ children }: { children?: React.ReactNode }) {
  return <span>{children}</span>;
}

export function SelectContent({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

export function SelectItem({ children, value, disabled, className = "" }: { children: React.ReactNode; value: string; disabled?: boolean; className?: string }) {
  return (
    <option value={value} disabled={disabled} className={className}>
      {children}
    </option>
  );
}

/* ─────────────────────────── Formatting ─────────────────────────── */

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
