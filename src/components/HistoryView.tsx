import { useState, useEffect } from "react";
import { Users, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { HistoryDetailModal, HistoryItem } from "./HistoryDetailModal";

interface HistoryViewProps {
    onClose: () => void;
    playerName: string;
    application: any; // Using any for Linera application for now
    preloadedData?: HistoryItem[]; // Optional pre-loaded history
}

export function HistoryView({ onClose, playerName, application, preloadedData = [] }: HistoryViewProps) {
    const [historySearchNick, setHistorySearchNick] = useState(playerName);
    const [historyImages, setHistoryImages] = useState<HistoryItem[]>(preloadedData); // Initialize with preloaded data
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [selectedHistoryItem, setSelectedHistoryItem] = useState<HistoryItem | null>(null);

    const getTimeAgo = (timestamp: string) => {
        const date = new Date(timestamp.endsWith('Z') ? timestamp : timestamp + 'Z');
        const now = new Date();
        const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

        if (seconds < 60) return 'just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    };

    const fetchHistory = async () => {
        const nick = historySearchNick.trim();
        if (!nick) return;
        setLoadingHistory(true);
        setHistoryImages([]);

        const wsUrl = (import.meta as any).env?.VITE_DRAWING_SERVER_WS_URL || 'wss://skribbl-linera.xyz/ws';
        const finalUrl = wsUrl.includes('wss://skribbl-linera.xyz/ws') && window.location.hostname === 'localhost'
            ? 'ws://localhost:8070'
            : wsUrl.replace('wss://', 'ws://');

        try {
            const ws = new WebSocket(finalUrl);
            await new Promise<void>((resolve, reject) => {
                ws.onopen = () => {
                    ws.send(JSON.stringify({ type: 'get_history', nickname: nick }));
                };
                ws.onmessage = async (evt) => {
                    const msg = JSON.parse(evt.data);
                    if (msg.type === 'history_result') {
                        try {
                            const images: HistoryItem[] = [];
                            for (const item of msg.history) {
                                const query = `{ "query": "query { dataBlob(hash: \\"${item.blob_hash}\\") }" }`;
                                try {
                                    const res = await application?.query(query);
                                    if (res) {
                                        const json = JSON.parse(res);
                                        const bytes = json.data?.dataBlob;
                                        if (bytes && Array.isArray(bytes)) {
                                            const uint8 = new Uint8Array(bytes);
                                            let imageUrl = "";
                                            let meta = undefined;

                                            try {
                                                const text = new TextDecoder().decode(uint8);
                                                const payload = JSON.parse(text);
                                                if (payload.image && payload.meta) {
                                                    imageUrl = payload.image;
                                                    meta = payload.meta;
                                                } else {
                                                    throw new Error("Not enriched blob");
                                                }
                                            } catch (e) {
                                                const blob = new Blob([uint8], { type: 'image/png' });
                                                imageUrl = URL.createObjectURL(blob);
                                            }

                                            images.push({
                                                blobHash: item.blob_hash,
                                                timestamp: item.timestamp,
                                                url: imageUrl,
                                                roomId: item.room_id,
                                                meta: meta
                                            });
                                        }
                                    }
                                } catch (e) {
                                    console.error("Failed to fetch blob:", item.blob_hash, e);
                                }
                            }
                            setHistoryImages(images);
                            resolve();
                        } catch (e) { reject(e); }
                        ws.close();
                    } else if (msg.type === 'history_error') {
                        reject(msg.message);
                        ws.close();
                    }
                };
                ws.onerror = () => reject("WS Error");
            });
        } catch (e) {
            console.error("History fetch error:", e);
        } finally {
            setLoadingHistory(false);
        }
    };

    // Auto-fetch only if no preloaded data
    useEffect(() => {
        if (playerName && application && preloadedData.length === 0) {
            fetchHistory();
        }
    }, []); // Empty deps - only run once on mount

    return (
        <div className="min-h-screen bg-white flex flex-col items-center p-4">
            <div className="w-full max-w-4xl space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                        <Users className="w-6 h-6 text-red-500" />
                        Drawing History
                    </h2>
                    <Button onClick={onClose} variant="ghost">Close</Button>
                </div>

                <div className="flex gap-2">
                    <Input
                        placeholder="Search by nickname..."
                        value={historySearchNick}
                        onChange={(e) => setHistorySearchNick(e.target.value)}
                    />
                    <Button onClick={fetchHistory} disabled={loadingHistory}>
                        {loadingHistory ? <Loader2 className="animate-spin" /> : "Search"}
                    </Button>
                </div>

                {loadingHistory ? (
                    <div className="text-center py-10"><Loader2 className="w-8 h-8 animate-spin mx-auto text-red-500" /></div>
                ) : historyImages.length === 0 ? (
                    <div className="text-center text-gray-400 py-10">No history found</div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {historyImages.map((img, i) => (
                            <div
                                key={i}
                                onClick={() => setSelectedHistoryItem(img)}
                                className="cursor-pointer border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition bg-gray-50 group relative"
                            >
                                <img src={img.url} alt="drawing" className="w-full h-48 object-cover bg-white" />
                                <div className="p-2 text-xs text-gray-500 flex justify-between">
                                    <span>{getTimeAgo(img.timestamp)}</span>
                                    <span title={img.roomId}>{img.roomId.slice(0, 6)}...</span>
                                </div>

                                {img.meta && (
                                    <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/60 text-white px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                                        <span>🔍</span> Click for details
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Modal is rendered here, at the root of the HistoryView returned structure */}
            {selectedHistoryItem && (
                <HistoryDetailModal
                    item={selectedHistoryItem}
                    onClose={() => setSelectedHistoryItem(null)}
                />
            )}
        </div>
    );
}
