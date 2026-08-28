"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Globe, Network, RefreshCw, ZoomIn, ZoomOut, RotateCcw, Settings, Download, ChevronLeft, X, Info } from "lucide-react";
import { Card, PageHeader, Button, Input } from "@/components/ui";

interface GraphNode {
  id: string;
  label: string;
  kind: string;
  meta?: Record<string, any>;
}

interface GraphEdge {
  from: string;
  to: string;
  kind: string;
  meta?: Record<string, any>;
}

interface GraphData {
  seed: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  counts: { nodes: number; edges: number };
  included_types: string[];
}

const KIND_COLORS: Record<string, string> = {
  apex: "#ef4444",
  host: "#3b82f6",
  ip: "#22c55e",
  cert: "#f59e0b",
  cname: "#8b5cf6",
  dns: "#06b6d4",
  favicon: "#ec4899",
  asn: "#f97316",
  org: "#14b8a6",
  cloud: "#6366f1",
  ssl_fp: "#a855f7",
};

const KIND_ICONS: Record<string, string> = {
  apex: "🎯",
  host: "🌐",
  ip: "🔢",
  cert: "🔐",
  cname: "🔗",
  dns: "📋",
  favicon: "🖼️",
  asn: "🔢",
  org: "🏢",
  cloud: "☁️",
  ssl_fp: "🔐",
};

export default function ASMGraphPage() {
  const [programmes, setProgrammes] = useState<{ id: string; name: string }[]>([]);
  const [programmeId, setProgrammeId] = useState("");
  const [seed, setSeed] = useState("");
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [depth, setDepth] = useState(2);
  const [maxNodes, setMaxNodes] = useState(500);
  const [include, setInclude] = useState<string[]>([
    "subdomain", "ip", "cert", "cname", "san", "asn", "org", "favicon", "ssl_fp", "cloud"
  ]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [layout, setLayout] = useState<"force" | "hierarchical" | "radial">("force");
  
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{ x: number; y: number; dragging: boolean }>({ x: 0, y: 0, dragging: false });

  useEffect(() => {
    fetch("/api/programmes")
      .then((r) => r.json())
      .then((d) => setProgrammes(d.programmes || []));
  }, []);

  const fetchGraph = useCallback(async () => {
    if (!seed.trim()) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        seed,
        depth: String(depth),
        max_nodes: String(maxNodes),
        include: include.join(","),
      });
      if (programmeId) params.set("programmeId", programmeId);
      
      const res = await fetch(`/api/explore/graph?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch graph");
      setGraph(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [seed, depth, maxNodes, include, programmeId]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newK = Math.min(Math.max(transform.k * scaleFactor, 0.1), 5);
    const newX = mouseX - (mouseX - transform.x) * (newK / transform.k);
    const newY = mouseY - (mouseY - transform.y) * (newK / transform.k);
    setTransform({ x: newX, y: newY, k: newK });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || e.target !== containerRef.current) return;
    dragRef.current = { x: e.clientX, y: e.clientY, dragging: true };
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      setTransform((t) => ({
        x: t.x + e.clientX - dragRef.current.x,
        y: t.y + e.clientY - dragRef.current.y,
        k: t.k,
      }));
      dragRef.current = { ...dragRef.current, x: e.clientX, y: e.clientY };
    };
    const handleMouseUp = () => {
      dragRef.current.dragging = false;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const zoomIn = () => setTransform((t) => ({ ...t, k: Math.min(t.k * 1.3, 5) }));
  const zoomOut = () => setTransform((t) => ({ ...t, k: Math.max(t.k / 1.3, 0.1) }));
  const resetView = () => setTransform({ x: 0, y: 0, k: 1 });

  const getNodePosition = (node: GraphNode, index: number, total: number) => {
    if (!graph) return { x: 0, y: 0 };
    
    const centerX = 400;
    const centerY = 300;
    
    if (layout === "radial") {
      // Radial layout around apex
      if (node.kind === "apex") return { x: centerX, y: centerY };
      const angle = (index / Math.max(total - 1, 1)) * Math.PI * 2;
      const radius = 150 + (node.kind === "host" ? 0 : node.kind === "ip" ? 50 : 100);
      return { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
    }
    
    if (layout === "hierarchical") {
      // Hierarchical: apex at top, then layers
      const layerMap: Record<string, number> = { apex: 0, host: 1, ip: 2, cert: 2, cname: 2, dns: 2, cert: 2 };
      const layer = layerMap[node.kind] || 1;
      const layerNodes = graph.nodes.filter((n) => (layerMap[n.kind] || 1) === layer);
      const layerIndex = layerNodes.findIndex((n) => n.id === node.id);
      const spacing = 180;
      return { x: centerX + (layerIndex - layerNodes.length / 2 + 0.5) * spacing, y: centerY + layer * 120 - 150 };
    }
    
    // Force-directed approximation (simplified)
    const angle = (index / total) * Math.PI * 2;
    const radius = 200;
    return { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
  };

  const downloadSVG = () => {
    if (!svgRef.current) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgRef.current);
    const blob = new Blob([source], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attack-surface-${seed}-${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleInclude = (type: string) => {
    setInclude((prev) => prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]);
  };

  return (
    <div className="space-y-5 h-[calc(100vh-200px)] min-h-[700px]">
      <PageHeader
        title="Pivot Graph"
        description="Interactive attack surface visualization — explore relationships between assets, certificates, DNS, and infrastructure."
        icon={Network}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={programmeId}
              onChange={(e) => setProgrammeId(e.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none"
              disabled={loading}
            >
              <option value="">All programmes</option>
              {programmes.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={fetchGraph} disabled={loading || !seed}>
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={downloadSVG} disabled={!graph}>
              <Download className="h-4 w-4" />
              Export SVG
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 flex items-center gap-2">
          <Info className="h-4 w-4" /> {error}
        </div>
      )}

      {/* Controls */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Seed Input */}
          <div className="flex items-center gap-2 flex-1 min-w-[300px]">
            <label className="text-xs text-muted-foreground whitespace-nowrap">Seed:</label>
            <Input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchGraph()}
              placeholder="example.com or 1.2.3.4"
              className="flex-1 font-mono"
              disabled={loading}
            />
            <Button onClick={fetchGraph} disabled={loading || !seed}>
              <Search className="h-4 w-4" />
            </Button>
          </div>

          {/* Depth & Max Nodes */}
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Depth:</span>
              <select
                value={depth}
                onChange={(e) => setDepth(parseInt(e.target.value))}
                className="rounded border border-border bg-surface-2 px-2 py-1 text-sm outline-none"
                disabled={loading}
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Max Nodes:</span>
              <select
                value={maxNodes}
                onChange={(e) => setMaxNodes(parseInt(e.target.value))}
                className="rounded border border-border bg-surface-2 px-2 py-1 text-sm outline-none"
                disabled={loading}
              >
                <option value={200}>200</option>
                <option value={500}>500</option>
                <option value={1000}>1000</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Layout:</span>
              <select
                value={layout}
                onChange={(e) => setLayout(e.target.value as any)}
                className="rounded border border-border bg-surface-2 px-2 py-1 text-sm outline-none"
              >
                <option value="force">Force</option>
                <option value="hierarchical">Hierarchical</option>
                <option value="radial">Radial</option>
              </select>
            </div>
          </div>

          {/* Relationship Types */}
          <div className="flex flex-wrap items-center gap-2 border-l border-border pl-4 ml-auto">
            <span className="text-xs text-muted-foreground">Relationships:</span>
            {[
              { key: "subdomain", label: "Subdomain" },
              { key: "ip", label: "IP" },
              { key: "cert", label: "TLS Cert" },
              { key: "cname", label: "CNAME" },
              { key: "san", label: "SAN" },
              { key: "asn", label: "ASN" },
              { key: "org", label: "Org" },
              { key: "favicon", label: "Favicon" },
              { key: "ssl_fp", label: "SSL FP" },
              { key: "cloud", label: "Cloud" },
            ].map(({ key, label }) => (
              <Button
                key={key}
                variant={include.includes(key) ? "default" : "outline"}
                size="sm"
                onClick={() => toggleInclude(key)}
                className="text-xs h-7 px-2 gap-1"
                disabled={loading}
              >
                {KIND_ICONS[key] || "•"} {label}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {/* Graph View */}
      <Card className="flex-1 relative overflow-hidden" style={{ minHeight: 500 }}>
        <div
          ref={containerRef}
          className="absolute inset-0 cursor-grab active:cursor-grabbing"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          style={{ touchAction: "none" }}
        >
          <svg
            ref={svgRef}
            className="w-full h-full"
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
              transformOrigin: "0 0",
            }}
          >
            {/* Defs for gradients and markers */}
            <defs>
              {graph?.edges.map((edge) => (
                <marker
                  key={`marker-${edge.kind}`}
                  id={`arrow-${edge.kind}`}
                  markerWidth="10"
                  markerHeight="10"
                  refX="8"
                  refY="3"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0,0 L0,6 L9,3 z" fill={KIND_COLORS[edge.kind] || "#64748b"} />
                </marker>
              ))}
            </defs>

            {/* Edges */}
            {graph?.edges.map((edge, i) => {
              const sourceNode = graph.nodes.find((n) => n.id === edge.from);
              const targetNode = graph.nodes.find((n) => n.id === edge.to);
              if (!sourceNode || !targetNode) return null;
              const sourcePos = getNodePosition(sourceNode, graph.nodes.indexOf(sourceNode), graph.nodes.length);
              const targetPos = getNodePosition(targetNode, graph.nodes.indexOf(targetNode), graph.nodes.length);
              const color = KIND_COLORS[edge.kind] || "#64748b";
              return (
                <line
                  key={i}
                  x1={sourcePos.x}
                  y1={sourcePos.y}
                  x2={targetPos.x}
                  y2={targetPos.y}
                  stroke={color}
                  strokeWidth={1.5}
                  strokeOpacity={0.6}
                  markerEnd={`url(#arrow-${edge.kind})`}
                  style={{ pointerEvents: "none" }}
                />
              );
            })}

            {/* Nodes */}
            {graph?.nodes.map((node, i) => {
              const pos = getNodePosition(node, i, graph.nodes.length);
              const color = KIND_COLORS[node.kind] || "#64748b";
              const isSelected = selectedNode?.id === node.id;
              return (
                <g
                  key={node.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onClick={() => setSelectedNode(isSelected ? null : node)}
                  style={{ cursor: "pointer" }}
                >
                  <circle
                    r={node.kind === "apex" ? 16 : isSelected ? 14 : 10}
                    fill={color}
                    fillOpacity={isSelected ? 1 : 0.9}
                    stroke={isSelected ? "#fff" : "#1e293b"}
                    strokeWidth={isSelected ? 3 : 2}
                    filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))"
                  />
                  {node.kind === "apex" && (
                    <text x={0} y={5} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={10} fontWeight="bold">
                      🎯
                    </text>
                  )}
                  {isSelected && (
                    <circle r={18} fill="none" stroke={color} strokeWidth={2} strokeDasharray="4,4" />
                  )}
                  <title>{node.label}\nKind: {node.kind}</title>
                </g>
              );
            })}

            {/* Node Labels (rendered on top) */}
            {graph?.nodes.map((node, i) => {
              const pos = getNodePosition(node, i, graph.nodes.length);
              const isSelected = selectedNode?.id === node.id;
              if (!isSelected && graph.nodes.length > 50) return null; // Too many nodes
              return (
                <text
                  key={`label-${node.id}`}
                  x={pos.x}
                  y={pos.y - 18}
                  textAnchor="middle"
                  dominantBaseline="bottom"
                  fontSize={9}
                  fill="#e2e8f0"
                  stroke="#0f172a"
                  strokeWidth={3}
                  paintOrder="stroke"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {node.label.length > 20 ? node.label.slice(0, 18) + "…" : node.label}
                </text>
              );
            })}
          </svg>
        </div>

        {/* Zoom Controls */}
        <div className="absolute bottom-4 right-4 flex flex-col gap-1">
          <Button variant="outline" size="icon" onClick={zoomIn} title="Zoom In">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={zoomOut} title="Zoom Out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={resetView} title="Reset View">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>

        {/* Legend */}
        <div className="absolute bottom-4 left-4 flex flex-wrap gap-2 max-w-[80%]">
          {Object.entries(KIND_COLORS).map(([kind, color]) => (
            graph?.nodes.some((n) => n.kind === kind) && (
              <div key={kind} className="flex items-center gap-1 px-2 py-1 rounded bg-surface-1/90 backdrop-blur border border-border/50 text-xs">
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", backgroundColor: color }} />
                {kind}
              </div>
            )
          ))}
        </div>
      </Card>

      {/* Node Detail Panel */}
      {selectedNode && (
        <Card className="fixed bottom-4 right-4 w-80 max-h-96 overflow-auto z-10 shadow-xl border-accent/30">
          <div className="flex items-center justify-between p-3 border-b">
            <div className="flex items-center gap-2">
              <span style={{ color: KIND_COLORS[selectedNode.kind] }} className="text-xl">{KIND_ICONS[selectedNode.kind] || "•"}</span>
              <div>
                <p className="font-mono text-sm truncate max-w-[200px]">{selectedNode.label}</p>
                <p className="text-xs text-muted-foreground capitalize">{selectedNode.kind}</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setSelectedNode(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="p-3 text-xs font-mono max-h-64 overflow-auto">
            {selectedNode.meta && Object.entries(selectedNode.meta).map(([k, v]) => (
              <div key={k} className="flex justify-between py-1 border-b border-border/30">
                <span className="text-muted-foreground">{k}:</span>
                <span className="truncate max-w-[150px] text-right">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
              </div>
            ))}
          </div>
          <div className="p-3 border-t flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setSeed(selectedNode.label)}>
              <Globe className="h-3 w-3 mr-1" /> Explore
            </Button>
            <Button variant="default" size="sm" className="flex-1" onClick={() => fetchGraph()}>
              <Network className="h-3 w-3 mr-1" /> Pivot
            </Button>
          </div>
        </Card>
      )}

      {/* Stats */}
      {graph && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="font-medium">Seed:</span>
            <code className="font-mono bg-surface-2 px-2 py-0.5 rounded">{graph.seed}</code>
            <span className="text-muted-foreground">|</span>
            <span>Nodes: <b>{graph.counts.nodes}</b></span>
            <span>Edges: <b>{graph.counts.edges}</b></span>
            <span className="text-muted-foreground">|</span>
            <span>Relationships: {graph.included_types.join(", ")}</span>
          </div>
        </Card>
      )}
    </div>
  );
}