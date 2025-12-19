import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import { Eraser, Trash2, Undo, Circle, Square, Pipette, PaintBucket } from "lucide-react";
import { Button } from "./ui/button";

interface CanvasProps {
  isDrawing: boolean;
  onCanvasChange: (data: string) => void;
  canvasData: string;
  roomId?: string;
  clientId?: string;
  userId?: number;
}

export type CanvasHandle = {
  clearCanvas: () => void;
  getDataURL: () => string;
  publishBlob: (metadata?: any) => Promise<string>;
  saveHistory: (blobHashes: string[], roomId: string, userId: number) => void;
};

interface Point {
  x: number;
  y: number;
}

type Tool = "brush" | "eraser" | "circle" | "rectangle" | "picker" | "fill";

export const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(
  { isDrawing, onCanvasChange, canvasData, roomId, clientId, userId }: CanvasProps & { userId?: number },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [lastPoint, setLastPoint] = useState<Point | null>(null);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [brushSize, setBrushSize] = useState(4);
  const [currentColor, setCurrentColor] = useState("#000000");
  const [currentTool, setCurrentTool] = useState<Tool>("brush");
  const [history, setHistory] = useState<string[]>([]);
  const [tempCanvas, setTempCanvas] = useState<string>("");

  // Extended color palette
  const colors = [
    "#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF",
    "#FFFF00", "#FF00FF", "#00FFFF", "#FFA500", "#800080",
    "#FFC0CB", "#A52A2A", "#808080", "#FFD700", "#4B0082"
  ];
  const brushSizes = [2, 4, 8, 16];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Fill with white background
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Load existing canvas data
    if (canvasData) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
      };
      img.src = canvasData;
    }
  }, []);

  // React to external blank canvasData to force local clear (e.g., drawer change)
  useEffect(() => {
    if (canvasData === "") {
      clearCanvasLocal();
    }
  }, [canvasData]);

  // WebSocket: connect to drawing server for the current room
  useEffect(() => {
    // Only close if we are actually LEAVING a room context, not just re-rendering
    // But here roomId/clientId are dependencies. If they change, we should reconnect.
    // If they are stable, we should keep the connection.

    // Check if we already have a valid connection for this room/client
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Ideally we verify if it's the right room, but for now assuming stability if props don't change
      return;
    }

    if (!roomId) return; // ClientId might be 'local' or empty initially, but roomId is key

    const wsUrl = (import.meta as any).env?.VITE_DRAWING_SERVER_WS_URL || 'wss://skribbl-linera.xyz/ws';
    const finalUrl = wsUrl.includes('wss://skribbl-linera.xyz/ws') && window.location.hostname === 'localhost'
      ? 'ws://localhost:8070'
      : wsUrl.replace('wss://', 'ws://');

    let ws: WebSocket | null = null;
    let active = true;

    try {
      ws = new WebSocket(finalUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!active) {
          ws?.close();
          return;
        }
        try {
          ws?.send(JSON.stringify({
            type: 'join',
            roomId,
            clientId: clientId || 'anon',
            userId: userId || null  // Send userId for history tracking
          }));
        } catch { }
      };

      ws.onmessage = (evt) => {
        if (!active) return;
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'draw') {
            drawNetworkLine({ x: msg.prevX, y: msg.prevY }, { x: msg.x, y: msg.y }, msg.color, msg.lineWidth);
          } else if (msg.type === 'clear') {
            clearCanvasLocal();
          } else if (msg.type === 'fill') {
            floodFill({ x: msg.x, y: msg.y }, msg.color);
            saveToHistory();
          } else if (msg.type === 'undo') {
            undo();
          } else if (msg.type === 'strokeEnd') {
            saveToHistory();
          }
        } catch { }
      };

      ws.onerror = (e) => {
        console.error("WS Error:", e);
      };

      ws.onclose = () => {
        if (active) {
          console.log("WS Closed");
          wsRef.current = null;
        }
      };
    } catch (e) { console.error("WS Setup Error:", e); }

    return () => {
      active = false;
      const cur = wsRef.current;
      if (cur) {
        // Send leave message but give it a moment? No, just close.
        try { cur.send(JSON.stringify({ type: 'leave', roomId, clientId })); } catch { }
        try { cur.close(); } catch { }
        wsRef.current = null;
      }
    };
  }, [roomId, clientId]);

  const saveToHistory = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const data = canvas.toDataURL();
    setHistory((prev) => [...prev.slice(-9), data]);
    onCanvasChange(data);
  };

  const clearCanvasLocal = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHistory([]);
    onCanvasChange(canvas.toDataURL());
  };

  const undo = () => {
    if (history.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const prevState = history[history.length - 1];
    setHistory((prev) => prev.slice(0, -1));

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      onCanvasChange(canvas.toDataURL());
    };
    img.src = prevState;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHistory([]);
    onCanvasChange(canvas.toDataURL());
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && roomId && clientId) {
      try { ws.send(JSON.stringify({ type: 'clear', roomId, drawerId: clientId })); } catch { }
    }
  };

  // Expose imperative API to parent
  useImperativeHandle(ref, () => ({
    clearCanvas: () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    },
    getDataURL: () => {
      return canvasRef.current?.toDataURL("image/jpeg", 0.8) || "";
    },
    publishBlob: async (metadata?: any) => {
      return new Promise((resolve, reject) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          reject("Not connected to drawing server");
          return;
        }
        const dataUrl = canvasRef.current?.toDataURL("image/jpeg", 0.8) || "";

        const handleMsg = (evt: MessageEvent) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === 'blob_published') {
              wsRef.current?.removeEventListener('message', handleMsg);
              resolve(msg.hash);
            } else if (msg.type === 'blob_error') {
              wsRef.current?.removeEventListener('message', handleMsg);
              reject(msg.message);
            }
          } catch (e) { }
        };
        wsRef.current.addEventListener('message', handleMsg);

        if (metadata) {
          // Enriched blob: send as generic JSON payload
          const payload = {
            image: dataUrl,
            meta: metadata,
            timestamp: Date.now()
          };
          wsRef.current.send(JSON.stringify({ type: 'publish_blob', payload: payload }));
        } else {
          // Legacy/Simple: send as image
          wsRef.current.send(JSON.stringify({ type: 'publish_blob', image: dataUrl }));
        }

        // Timeout
        setTimeout(() => {
          wsRef.current?.removeEventListener('message', handleMsg);
          reject("Timeout publishing blob");
        }, 10000);
      });
    },
    saveHistory: (blobHashes: string[], roomId: string, userId: number) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'save_history',
          userId: userId,
          roomId: roomId,
          blobHashes: blobHashes
        }));
      }
    }
  }));

  const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const getTouchPos = (e: React.TouchEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    return {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
    };
  };

  const drawLine = (from: Point, to: Point) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.strokeStyle = currentTool === "eraser" ? "#FFFFFF" : currentColor;
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  const drawNetworkLine = (from: Point, to: Point, color: string, lineWidth: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  const drawCircle = (start: Point, end: Point, isTemp: boolean = false) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    if (!isTemp && tempCanvas) {
      // Restore the saved canvas state
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        // Now draw the final circle
        const radius = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = brushSize;
        ctx.beginPath();
        ctx.arc(start.x, start.y, radius, 0, 2 * Math.PI);
        ctx.stroke();
      };
      img.src = tempCanvas;
      return;
    }

    const radius = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = brushSize;
    ctx.beginPath();
    ctx.arc(start.x, start.y, radius, 0, 2 * Math.PI);
    ctx.stroke();
  };

  const drawRectangle = (start: Point, end: Point, isTemp: boolean = false) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    if (!isTemp && tempCanvas) {
      // Restore the saved canvas state
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        // Now draw the final rectangle
        const width = end.x - start.x;
        const height = end.y - start.y;
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = brushSize;
        ctx.strokeRect(start.x, start.y, width, height);
      };
      img.src = tempCanvas;
      return;
    }

    const width = end.x - start.x;
    const height = end.y - start.y;
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = brushSize;
    ctx.strokeRect(start.x, start.y, width, height);
  };

  const floodFill = (startPoint: Point, fillColor: string) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;

    const startPos = (Math.floor(startPoint.y) * canvas.width + Math.floor(startPoint.x)) * 4;
    const startR = pixels[startPos];
    const startG = pixels[startPos + 1];
    const startB = pixels[startPos + 2];
    const startA = pixels[startPos + 3];

    // Convert fill color to RGB
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) return;
    tempCtx.fillStyle = fillColor;
    tempCtx.fillRect(0, 0, 1, 1);
    const fillData = tempCtx.getImageData(0, 0, 1, 1).data;
    const fillR = fillData[0];
    const fillG = fillData[1];
    const fillB = fillData[2];

    // Check if already the same color
    if (startR === fillR && startG === fillG && startB === fillB) return;

    const pixelStack: Point[] = [{ x: Math.floor(startPoint.x), y: Math.floor(startPoint.y) }];
    const visited = new Set<string>();

    while (pixelStack.length > 0) {
      const point = pixelStack.pop();
      if (!point) continue;

      const key = `${point.x},${point.y}`;
      if (visited.has(key)) continue;
      if (point.x < 0 || point.x >= canvas.width || point.y < 0 || point.y >= canvas.height) continue;

      visited.add(key);
      const pos = (point.y * canvas.width + point.x) * 4;

      const r = pixels[pos];
      const g = pixels[pos + 1];
      const b = pixels[pos + 2];
      const a = pixels[pos + 3];

      if (r === startR && g === startG && b === startB && a === startA) {
        pixels[pos] = fillR;
        pixels[pos + 1] = fillG;
        pixels[pos + 2] = fillB;
        pixels[pos + 3] = 255;

        pixelStack.push({ x: point.x + 1, y: point.y });
        pixelStack.push({ x: point.x - 1, y: point.y });
        pixelStack.push({ x: point.x, y: point.y + 1 });
        pixelStack.push({ x: point.x, y: point.y - 1 });
      }
    }

    ctx.putImageData(imageData, 0, 0);
  };

  const broadcastFill = (point: Point, color: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !roomId || !clientId) return;
    const payload = {
      type: 'fill',
      roomId,
      clientId,
      x: point.x,
      y: point.y,
      color,
      drawerId: clientId,
    };
    try { ws.send(JSON.stringify(payload)); } catch { }
  };

  const broadcastSegment = (from: Point, to: Point) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !roomId || !clientId) return;
    const payload = {
      type: 'draw',
      roomId,
      clientId,
      x: to.x,
      y: to.y,
      prevX: from.x,
      prevY: from.y,
      color: currentTool === 'eraser' ? '#FFFFFF' : currentColor,
      lineWidth: brushSize,
      drawerId: clientId,
    };
    try { ws.send(JSON.stringify(payload)); } catch { }
  };

  const pickColor = (point: Point) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const imageData = ctx.getImageData(point.x, point.y, 1, 1);
    const data = imageData.data;
    const hex = "#" + ((1 << 24) + (data[0] << 16) + (data[1] << 8) + data[2]).toString(16).slice(1);
    setCurrentColor(hex.toUpperCase());
    setCurrentTool("brush");
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    setIsMouseDown(true);
    const point = getMousePos(e);
    setLastPoint(point);
    setStartPoint(point);

    // Save canvas state for shape tools
    if (currentTool === "circle" || currentTool === "rectangle") {
      const canvas = canvasRef.current;
      if (canvas) {
        setTempCanvas(canvas.toDataURL());
      }
    }

    // Handle single-click tools
    if (currentTool === "fill") {
      floodFill(point, currentColor);
      saveToHistory();
      broadcastFill(point, currentColor);
    } else if (currentTool === "picker") {
      pickColor(point);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !isMouseDown || !lastPoint) return;
    const point = getMousePos(e);

    if (currentTool === "brush" || currentTool === "eraser") {
      drawLine(lastPoint, point);
      broadcastSegment(lastPoint, point);
      setLastPoint(point);
    } else if ((currentTool === "circle" || currentTool === "rectangle") && startPoint) {
      // Clear and redraw with preview
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx || !tempCanvas) return;

      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        if (currentTool === "circle") {
          drawCircle(startPoint, point, true);
        } else {
          drawRectangle(startPoint, point, true);
        }
      };
      img.src = tempCanvas;
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing || !isMouseDown) return;

    if ((currentTool === "circle" || currentTool === "rectangle") && startPoint && lastPoint) {
      const point = lastPoint;
      if (currentTool === "circle") {
        drawCircle(startPoint, point, false);
      } else {
        drawRectangle(startPoint, point, false);
      }
      setTempCanvas("");
    }

    setIsMouseDown(false);
    setLastPoint(null);
    setStartPoint(null);

    if (currentTool !== "picker") {
      saveToHistory();
      // Notify others to snapshot their history after a stroke
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && roomId && clientId) {
        try { ws.send(JSON.stringify({ type: 'strokeEnd', roomId, drawerId: clientId })); } catch { }
      }
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();
    setIsMouseDown(true);
    const point = getTouchPos(e);
    setLastPoint(point);
    setStartPoint(point);

    if (currentTool === "circle" || currentTool === "rectangle") {
      const canvas = canvasRef.current;
      if (canvas) {
        setTempCanvas(canvas.toDataURL());
      }
    }

    if (currentTool === "fill") {
      floodFill(point, currentColor);
      saveToHistory();
      broadcastFill(point, currentColor);
    } else if (currentTool === "picker") {
      pickColor(point);
    }
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    undo();
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && roomId && clientId) {
      try { ws.send(JSON.stringify({ type: 'undo', roomId, drawerId: clientId })); } catch { }
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !isMouseDown || !lastPoint) return;
    e.preventDefault();
    const point = getTouchPos(e);

    if (currentTool === "brush" || currentTool === "eraser") {
      drawLine(lastPoint, point);
      broadcastSegment(lastPoint, point);
      setLastPoint(point);
    } else if ((currentTool === "circle" || currentTool === "rectangle") && startPoint) {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx || !tempCanvas) return;

      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        if (currentTool === "circle") {
          drawCircle(startPoint, point, true);
        } else {
          drawRectangle(startPoint, point, true);
        }
      };
      img.src = tempCanvas;
    }
  };

  const handleTouchEnd = () => {
    if (!isDrawing || !isMouseDown) return;

    if ((currentTool === "circle" || currentTool === "rectangle") && startPoint && lastPoint) {
      const point = lastPoint;
      if (currentTool === "circle") {
        drawCircle(startPoint, point, false);
      } else {
        drawRectangle(startPoint, point, false);
      }
      setTempCanvas("");
    }

    setIsMouseDown(false);
    setLastPoint(null);
    setStartPoint(null);

    if (currentTool !== "picker") {
      saveToHistory();
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && roomId && clientId) {
        try { ws.send(JSON.stringify({ type: 'strokeEnd', roomId, drawerId: clientId })); } catch { }
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-4">
      {/* Tools */}
      {isDrawing && (
        <div className="bg-white border-2 border-black rounded-lg p-4">
          <div className="flex items-center gap-6 flex-wrap">
            {/* Color Picker and Palette */}
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-1">
                <input
                  type="color"
                  value={currentColor}
                  onChange={(e) => {
                    setCurrentColor(e.target.value);
                    if (currentTool === "eraser") setCurrentTool("brush");
                  }}
                  className="w-12 h-12 rounded-lg border-2 border-black cursor-pointer"
                  title="Custom color"
                />
              </div>
              <div className="grid grid-cols-5 gap-1">
                {colors.map((color) => (
                  <button
                    key={color}
                    onClick={() => {
                      setCurrentColor(color);
                      if (currentTool === "eraser") setCurrentTool("brush");
                    }}
                    className={`w-8 h-8 rounded border-2 transition-all ${currentColor === color && currentTool !== "eraser"
                      ? "border-red-500 scale-110"
                      : "border-black hover:scale-105"
                      }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <div className="w-px h-16 bg-black" />

            {/* Brush sizes */}
            <div className="flex gap-2">
              {brushSizes.map((size) => (
                <button
                  key={size}
                  onClick={() => setBrushSize(size)}
                  className={`w-10 h-10 rounded-lg border-2 flex items-center justify-center transition-all ${brushSize === size
                    ? "border-red-500 bg-red-500"
                    : "border-black bg-white hover:bg-black/5"
                    }`}
                  aria-label={`Brush size ${size}`}
                >
                  <div
                    className="rounded-full bg-black"
                    style={{ width: size * 1.5, height: size * 1.5 }}
                  />
                </button>
              ))}
            </div>

            <div className="w-px h-16 bg-black" />

            {/* Drawing Tools */}
            <div className="flex gap-2 flex-wrap">
              <Button
                variant={currentTool === "eraser" ? "default" : "outline"}
                size="icon"
                onClick={() => setCurrentTool(currentTool === "eraser" ? "brush" : "eraser")}
                className={currentTool === "eraser" ? "bg-red-500 hover:bg-red-600 border-2 border-black" : "border-2 border-black"}
                title="Eraser"
              >
                <Eraser className="w-5 h-5" />
              </Button>

              <Button
                variant={currentTool === "circle" ? "default" : "outline"}
                size="icon"
                onClick={() => setCurrentTool(currentTool === "circle" ? "brush" : "circle")}
                className={currentTool === "circle" ? "bg-red-500 hover:bg-red-600 border-2 border-black" : "border-2 border-black"}
                title="Circle"
              >
                <Circle className="w-5 h-5" />
              </Button>

              <Button
                variant={currentTool === "rectangle" ? "default" : "outline"}
                size="icon"
                onClick={() => setCurrentTool(currentTool === "rectangle" ? "brush" : "rectangle")}
                className={currentTool === "rectangle" ? "bg-red-500 hover:bg-red-600 border-2 border-black" : "border-2 border-black"}
                title="Rectangle"
              >
                <Square className="w-5 h-5" />
              </Button>

              <Button
                variant={currentTool === "fill" ? "default" : "outline"}
                size="icon"
                onClick={() => setCurrentTool(currentTool === "fill" ? "brush" : "fill")}
                className={currentTool === "fill" ? "bg-red-500 hover:bg-red-600 border-2 border-black" : "border-2 border-black"}
                title="Fill bucket"
              >
                <PaintBucket className="w-5 h-5" />
              </Button>

              <Button
                variant={currentTool === "picker" ? "default" : "outline"}
                size="icon"
                onClick={() => setCurrentTool(currentTool === "picker" ? "brush" : "picker")}
                className={currentTool === "picker" ? "bg-red-500 hover:bg-red-600 border-2 border-black" : "border-2 border-black"}
                title="Color picker"
              >
                <Pipette className="w-5 h-5" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                onClick={handleUndo}
                disabled={history.length === 0}
                className="border-2 border-black"
                title="Undo"
              >
                <Undo className="w-5 h-5" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                onClick={clearCanvas}
                className="border-2 border-black"
                title="Clear canvas"
              >
                <Trash2 className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 bg-white border-2 border-black rounded-lg overflow-hidden relative">
        {!isDrawing && (
          <div className="absolute inset-0 bg-black/5 z-10 flex items-center justify-center">
            <div className="bg-white border-2 border-black px-6 py-3 rounded-lg">
              Another player is drawing
            </div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className={`w-full h-full ${isDrawing
            ? currentTool === "picker"
              ? "cursor-crosshair"
              : currentTool === "fill"
                ? "cursor-pointer"
                : "cursor-crosshair"
            : "cursor-not-allowed"
            }`}
          style={{ touchAction: "none" }}
        />
      </div>
    </div>
  );
});
