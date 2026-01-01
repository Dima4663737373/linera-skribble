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
    const [historySearchNick, setHistorySearchNick] = useState("");
    const [historyImages, setHistoryImages] = useState<HistoryItem[]>(preloadedData); // Initialize with preloaded data
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [selectedHistoryItem, setSelectedHistoryItem] = useState<HistoryItem | null>(null);

    const normalizeTimestamp = (value: unknown) => {
        const raw = String(value ?? "").trim();
        if (/^\d+$/.test(raw)) {
            const n = Number(raw);
            if (Number.isFinite(n)) {
                if (raw.length >= 16) return new Date(Math.floor(n / 1000)).toISOString();
                if (raw.length >= 13) return new Date(n).toISOString();
                return new Date(n * 1000).toISOString();
            }
        }
        const d1 = new Date(raw);
        if (!Number.isNaN(d1.getTime())) return d1.toISOString();
        const d2 = new Date(raw.endsWith("Z") ? raw : `${raw}Z`);
        if (!Number.isNaN(d2.getTime())) return d2.toISOString();
        return new Date().toISOString();
    };

    const normalizeMeta = (meta: any): HistoryItem["meta"] | undefined => {
        if (!meta || typeof meta !== "object") return undefined;
        const round = Number(meta.round);
        const word = typeof meta.word === "string" ? meta.word : "";
        const playersRaw = Array.isArray(meta.players) ? meta.players : [];
        const chatRaw = Array.isArray(meta.chat) ? meta.chat : [];

        const players = playersRaw
            .map((p: any) => ({
                id: String(p?.id ?? p?.chainId ?? ""),
                name: String(p?.name ?? ""),
                score: Number(p?.score ?? 0) || 0,
                avatarJson: typeof p?.avatarJson === "string"
                    ? p.avatarJson
                    : (typeof p?.avatar_json === "string" ? p.avatar_json : ""),
            }))
            .filter((p: any) => p.id || p.name);

        const chat = chatRaw
            .map((m: any) => ({
                sender: String(m?.sender ?? m?.playerName ?? ""),
                text: String(m?.text ?? m?.message ?? ""),
            }))
            .filter((m: any) => m.sender && m.text);

        if (!Number.isFinite(round) && !word && players.length === 0 && chat.length === 0) return undefined;

        return {
            round: Number.isFinite(round) ? round : 0,
            word,
            players,
            chat,
        };
    };

    const getTimeAgo = (timestamp: string) => {
        const date = new Date(normalizeTimestamp(timestamp));
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
        setLoadingHistory(true);
        if (!application) {
            setLoadingHistory(false);
            return;
        }

        try {
            const gql = "query{archivedRooms{roomId,timestamp,blobHashes}}";
            const res = await application.query(JSON.stringify({ query: gql }));
            const json = typeof res === "string" ? JSON.parse(res) : res;
            const rooms: Array<{ roomId: string; blobHashes: string[]; timestamp: string }> = json?.data?.archivedRooms || [];

            const images: HistoryItem[] = [];
            for (const room of rooms) {
                const roomId = room.roomId;
                const roomTs = normalizeTimestamp(room.timestamp);
                const hashes = Array.isArray(room.blobHashes) ? room.blobHashes : [];
                for (const blobHash of hashes) {
                    const q = `query{dataBlob(hash:"${String(blobHash).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")}`;
                    try {
                        const blobRes = await application.query(JSON.stringify({ query: q }));
                        const blobJson = typeof blobRes === "string" ? JSON.parse(blobRes) : blobRes;
                        const bytes = blobJson?.data?.dataBlob ?? blobJson?.dataBlob;
                        if (!bytes || !Array.isArray(bytes)) continue;

                        const uint8 = new Uint8Array(bytes);
                        let imageUrl = "";
                        let meta: HistoryItem["meta"] | undefined = undefined;
                        let itemTs = roomTs;

                        try {
                            const text = new TextDecoder().decode(uint8);
                            const payload = JSON.parse(text);
                            if (payload?.image) {
                                imageUrl = payload.image;
                                meta = normalizeMeta(payload?.meta);
                                if (payload?.timestamp !== undefined && payload?.timestamp !== null) {
                                    itemTs = normalizeTimestamp(payload.timestamp);
                                }
                            } else {
                                throw new Error("not_json_image");
                            }
                        } catch {
                            const blob = new Blob([uint8], { type: "image/png" });
                            imageUrl = URL.createObjectURL(blob);
                        }

                        images.push({
                            blobHash,
                            timestamp: itemTs,
                            url: imageUrl,
                            roomId,
                            meta,
                        });
                    } catch (e) {
                        console.error("Failed to fetch blob:", blobHash, e);
                    }
                }
            }
            images.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
            setHistoryImages(images);
        } catch (e) {
            console.error("History fetch error:", e);
        } finally {
            setLoadingHistory(false);
        }
    };

    // Auto-fetch only if no preloaded data
    useEffect(() => {
        if (application && preloadedData.length === 0) fetchHistory();
    }, [application, preloadedData.length]);

    const filterText = historySearchNick.trim().toLowerCase();
    const filteredImages = filterText
        ? historyImages.filter((img) => {
            if (img.roomId.toLowerCase().includes(filterText)) return true;
            if (img.blobHash.toLowerCase().includes(filterText)) return true;
            const word = img.meta?.word ? img.meta.word.toLowerCase() : "";
            if (word && word.includes(filterText)) return true;
            const players = img.meta?.players ?? [];
            return players.some((p) => String(p?.name ?? "").toLowerCase().includes(filterText));
        })
        : historyImages;

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
                        placeholder="Search by nickname / word / room id..."
                        value={historySearchNick}
                        onChange={(e) => setHistorySearchNick(e.target.value)}
                    />
                    <Button onClick={fetchHistory} disabled={loadingHistory}>
                        {loadingHistory ? <Loader2 className="animate-spin" /> : "Refresh"}
                    </Button>
                </div>

                {loadingHistory ? (
                    <div className="text-center py-10"><Loader2 className="w-8 h-8 animate-spin mx-auto text-red-500" /></div>
                ) : filteredImages.length === 0 ? (
                    <div className="text-center text-gray-400 py-10">No history found</div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {filteredImages.map((img, i) => (
                            <div
                                key={i}
                                onClick={() => setSelectedHistoryItem(img)}
                                className="cursor-pointer border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition bg-gray-50 group relative"
                            >
                                <img src={img.url} alt="drawing" className="w-full h-48 object-cover bg-white" />
                                <div className="p-2 text-xs text-gray-500">
                                    <div className="flex justify-between">
                                        <span>{getTimeAgo(img.timestamp)}</span>
                                        <span title={img.roomId}>{img.roomId.slice(0, 6)}...</span>
                                    </div>
                                    {img.meta?.word && (
                                        <div className="mt-1 text-black/70 font-medium truncate" title={img.meta.word}>
                                            {img.meta.word.toUpperCase()} {Number.isFinite(img.meta.round) && img.meta.round > 0 ? `• R${img.meta.round}` : ""}
                                        </div>
                                    )}
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
