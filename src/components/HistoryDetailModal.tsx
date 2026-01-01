import { X, Clock, Trophy, MessageCircle, Users } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "./ui/button";
import { CharacterAvatar } from "./CharacterAvatar";
import { getCharacterIdForPlayer, getCharacterPropsById, parseAvatarJson } from "../utils/characters";

export interface HistoryItem {
    blobHash: string;
    timestamp: string;
    url: string;
    roomId: string;
    meta?: {
        round: number;
        word: string;
        players: { id: string; name: string; score: number; avatarJson?: string }[];
        chat: { sender: string; text: string }[];
    };
}

interface HistoryDetailModalProps {
    item: HistoryItem;
    onClose: () => void;
}

export function HistoryDetailModal({ item, onClose }: HistoryDetailModalProps) {
    if (!item) return null

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const players = (item.meta?.players ?? []).slice().sort((a, b) => b.score - a.score);
    const chat = item.meta?.chat ?? [];

    return createPortal(
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 99999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '16px',
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
            }}
            onClick={onClose}
        >
            {/* Modal Container - Matching project style */}
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    backgroundColor: 'white',
                    border: '2px solid black',
                    borderRadius: '8px', // rounded-lg
                    maxWidth: '900px',
                    width: '100%',
                    maxHeight: '90vh',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                {/* Header - Black with red accent like project logo */}
                <div
                    style={{
                        backgroundColor: 'black',
                        padding: '16px 20px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div
                            style={{
                                backgroundColor: '#ef4444', // red-500
                                padding: '8px',
                                borderRadius: '8px',
                            }}
                        >
                            <Users style={{ width: '20px', height: '20px', color: 'white' }} />
                        </div>
                        <div>
                            <h2 style={{ color: 'white', fontSize: '18px', fontWeight: '700', margin: 0 }}>
                                {item.meta?.word ? item.meta.word.toUpperCase() : 'DRAWING'}
                            </h2>
                            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px', margin: 0, marginTop: '2px' }}>
                                {item.meta ? `Round ${item.meta.round}` : 'Legacy Drawing'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            backgroundColor: 'transparent',
                            border: '2px solid rgba(255,255,255,0.3)',
                            padding: '8px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <X style={{ width: '18px', height: '18px', color: 'white' }} />
                    </button>
                </div>

                {/* Content */}
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'row',
                        flex: 1,
                        overflow: 'hidden',
                    }}
                >
                    {/* Left: Image */}
                    <div
                        style={{
                            flex: '2',
                            backgroundColor: '#f9fafb', // gray-50
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '20px',
                            minHeight: '300px',
                        }}
                    >
                        <img
                            src={item.url}
                            alt="drawing"
                            style={{
                                maxWidth: '100%',
                                maxHeight: '55vh',
                                objectFit: 'contain',
                                border: '2px solid black',
                                borderRadius: '8px',
                                backgroundColor: 'white',
                            }}
                        />
                    </div>

                    {/* Right: Info Panel */}
                    <div
                        style={{
                            flex: '1',
                            minWidth: '280px',
                            maxWidth: '320px',
                            backgroundColor: 'white',
                            borderLeft: '2px solid black',
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                        }}
                    >
                        {/* Timestamp */}
                        <div style={{
                            padding: '12px 16px',
                            borderBottom: '2px solid #e5e7eb',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            color: '#6b7280', // gray-500
                            fontSize: '13px',
                        }}>
                            <Clock style={{ width: '14px', height: '14px' }} />
                            {formatDate(item.timestamp)}
                        </div>
                        <div style={{
                            padding: '12px 16px',
                            borderBottom: '2px solid #e5e7eb',
                            color: '#6b7280',
                            fontSize: '12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                        }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <span style={{ fontWeight: 700, color: 'black' }}>Room</span>
                                <span style={{ fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.roomId}>
                                    {item.roomId}
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <span style={{ fontWeight: 700, color: 'black' }}>Blob</span>
                                <span style={{ fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.blobHash}>
                                    {item.blobHash}
                                </span>
                            </div>
                        </div>

                        {/* Scrollable Content */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
                            {item.meta ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    {/* Leaderboard */}
                                    <div>
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                marginBottom: '10px',
                                                paddingBottom: '8px',
                                                borderBottom: '2px solid black',
                                            }}
                                        >
                                            <Trophy style={{ width: '16px', height: '16px', color: '#ef4444' }} />
                                            <span style={{ fontWeight: '700', fontSize: '14px', color: 'black' }}>
                                                Leaderboard
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            {players.map((p, idx) => (
                                                <div
                                                    key={p.id}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        padding: '8px 10px',
                                                        backgroundColor: idx === 0 ? '#fef2f2' : '#f9fafb',
                                                        border: idx === 0 ? '2px solid #ef4444' : '2px solid #e5e7eb',
                                                        borderRadius: '6px',
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <div style={{ width: 34, height: 34, overflow: 'hidden', borderRadius: 8, border: '2px solid #000', background: 'white', flexShrink: 0 }}>
                                                            <CharacterAvatar
                                                                props={parseAvatarJson(p.avatarJson || "") || getCharacterPropsById(getCharacterIdForPlayer(p.id, ""))}
                                                                className="w-full h-full flex items-center justify-center"
                                                            />
                                                        </div>
                                                        <span
                                                            style={{
                                                                width: '22px',
                                                                height: '22px',
                                                                borderRadius: '50%',
                                                                backgroundColor: idx === 0 ? '#ef4444' : 'black',
                                                                color: 'white',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                fontSize: '11px',
                                                                fontWeight: '700',
                                                            }}
                                                        >
                                                            {idx + 1}
                                                        </span>
                                                        <span style={{ fontWeight: '500', color: 'black', fontSize: '13px' }}>
                                                            {p.name}
                                                        </span>
                                                    </div>
                                                    <span
                                                        style={{
                                                            backgroundColor: idx === 0 ? '#ef4444' : 'black',
                                                            color: 'white',
                                                            padding: '3px 8px',
                                                            borderRadius: '12px',
                                                            fontSize: '11px',
                                                            fontWeight: '600',
                                                        }}
                                                    >
                                                        {p.score} pts
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Chat Log */}
                                    <div>
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                marginBottom: '10px',
                                                paddingBottom: '8px',
                                                borderBottom: '2px solid black',
                                            }}
                                        >
                                            <MessageCircle style={{ width: '16px', height: '16px', color: '#ef4444' }} />
                                            <span style={{ fontWeight: '700', fontSize: '14px', color: 'black' }}>
                                                Chat Log
                                            </span>
                                            <span
                                                style={{
                                                    backgroundColor: '#ef4444',
                                                    color: 'white',
                                                    fontSize: '10px',
                                                    padding: '2px 6px',
                                                    borderRadius: '8px',
                                                    fontWeight: '600',
                                                }}
                                            >
                                                {item.meta.chat?.length || 0}
                                            </span>
                                        </div>
                                        <div
                                            style={{
                                                backgroundColor: '#f9fafb',
                                                border: '2px solid #e5e7eb',
                                                borderRadius: '6px',
                                                padding: '10px',
                                                maxHeight: '180px',
                                                overflowY: 'auto',
                                            }}
                                        >
                                            {item.meta.chat?.length ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                    {chat.map((m, idx) => (
                                                        <div key={idx} style={{ fontSize: '12px', lineHeight: '1.4' }}>
                                                            <span style={{ fontWeight: '600', color: '#ef4444' }}>
                                                                {m.sender}:
                                                            </span>{' '}
                                                            <span style={{ color: '#374151' }}>{m.text}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p style={{
                                                    color: '#9ca3af',
                                                    fontStyle: 'italic',
                                                    textAlign: 'center',
                                                    margin: '16px 0',
                                                    fontSize: '13px'
                                                }}>
                                                    No chat messages
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        padding: '32px 16px',
                                        color: '#9ca3af',
                                    }}
                                >
                                    <Users style={{ width: '36px', height: '36px', marginBottom: '12px', opacity: 0.4 }} />
                                    <p style={{ fontSize: '13px', textAlign: 'center' }}>
                                        Legacy drawing without metadata
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Footer Button */}
                        <div style={{ padding: '12px 16px', borderTop: '2px solid #e5e7eb' }}>
                            <Button
                                onClick={onClose}
                                style={{
                                    width: '100%',
                                    height: '40px',
                                    backgroundColor: '#ef4444',
                                    color: 'white',
                                    border: '2px solid #9ca3af',
                                    borderRadius: '6px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                }}
                            >
                                Close
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
