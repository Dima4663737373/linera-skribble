import { useState, useEffect } from "react";
import { Users, UserPlus, Check, X, Bell, Loader2, Play, Copy, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { useLinera } from "./LineraProvider";

interface FriendsDialogProps {
  currentChainId: string;
  onInviteToGame?: (friendChainId: string) => void | Promise<void>;
  onJoinFromInvite?: (hostChainId: string) => void;
  gameMode?: boolean;
}

export function FriendsDialog({ currentChainId, onInviteToGame, onJoinFromInvite, gameMode = false }: FriendsDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"friends" | "requests">("friends");
  const [notice, setNotice] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [friends, setFriends] = useState<string[]>([]);
  const [friendRequests, setFriendRequests] = useState<string[]>([]);
  const [roomInvitations, setRoomInvitations] = useState<{ hostChainId: string; timestamp: string }[]>([]);
  const [newFriendId, setNewFriendId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [invitingFriendId, setInvitingFriendId] = useState<string | null>(null);
  const [acceptingInviteHostId, setAcceptingInviteHostId] = useState<string | null>(null);
  const { application } = useLinera();

  const escapeGqlString = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n");

  const showNotice = (type: "success" | "error" | "info", message: string) => {
    setNotice({ type, message });
    window.setTimeout(() => setNotice((prev) => (prev?.message === message ? null : prev)), 2500);
  };

  const fetchData = async () => {
    if (!application) return;
    try {
      const gql = "query { friends friendRequestsReceived roomInvitations { hostChainId timestamp } }";
      const res = await application.query(JSON.stringify({ query: gql }));
      const json = JSON.parse(res);
      const data = json.data;
      if (data) {
        setFriends(data.friends || []);
        setFriendRequests(data.friendRequestsReceived || []);
        setRoomInvitations(data.roomInvitations || []);
      }
    } catch (e) {
      console.error("Failed to fetch friends data", e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchData();
      const interval = setInterval(fetchData, 2000);
      return () => clearInterval(interval);
    }
  }, [isOpen, application]);

  const handleAddFriend = async () => {
    if (!newFriendId.trim() || !application) return;
    setIsLoading(true);
    try {
      const target = escapeGqlString(newFriendId.trim());
      await application.query(JSON.stringify({ query: `mutation { requestFriend(targetChainId: "${target}") }` }));
      setNewFriendId("");
      showNotice("success", "Request sent");
    } catch (e) {
      showNotice("error", "Failed to send request");
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAcceptFriend = async (chainId: string) => {
    if (!application) return;
    try {
      const requester = escapeGqlString(chainId);
      await application.query(JSON.stringify({ query: `mutation { acceptFriend(requesterChainId: "${requester}") }` }));
      showNotice("success", "Friend request accepted");
      fetchData();
    } catch (e) {
      showNotice("error", "Failed to accept friend request");
      console.error(e);
    }
  };

  const handleDeclineFriend = async (chainId: string) => {
    if (!application) return;
    try {
      const requester = escapeGqlString(chainId);
      await application.query(JSON.stringify({ query: `mutation { declineFriend(requesterChainId: "${requester}") }` }));
      showNotice("info", "Friend request declined");
      fetchData();
    } catch (e) {
      showNotice("error", "Failed to decline friend request");
      console.error(e);
    }
  };

  const handleAcceptInvite = async (hostId: string) => {
    if (!application) return;
    setAcceptingInviteHostId(hostId);
    try {
      const playerName = localStorage.getItem("skribbl_nickname") || "Player";
      const host = escapeGqlString(hostId);
      const name = escapeGqlString(playerName);
      await application.query(JSON.stringify({ query: `mutation { acceptInvite(hostChainId: "${host}", playerName: "${name}") }` }));
      setIsOpen(false);
      onJoinFromInvite?.(hostId);
    } catch (e) {
      showNotice("error", "Failed to accept invite");
      console.error(e);
    } finally {
      setAcceptingInviteHostId(null);
    }
  };

  const handleDeclineInvite = async (hostId: string) => {
    if (!application) return;
    try {
      const host = escapeGqlString(hostId);
      await application.query(JSON.stringify({ query: `mutation { declineInvite(hostChainId: "${host}") }` }));
      showNotice("info", "Invite declined");
      fetchData();
    } catch (e) {
      showNotice("error", "Failed to decline invite");
      console.error(e);
    }
  };

  const handleInviteToGame = async (friendChainId: string) => {
    if (!onInviteToGame) return;
    setInvitingFriendId(friendChainId);
    try {
      await onInviteToGame(friendChainId);
      showNotice("success", "Invite sent");
    } catch (e) {
      showNotice("error", "Failed to send invite");
      console.error(e);
    } finally {
      setInvitingFriendId((prev) => (prev === friendChainId ? null : prev));
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => showNotice("success", "Copied"))
      .catch(() => showNotice("error", "Copy failed"));
  };

  const totalNotifications = friendRequests.length + roomInvitations.length;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          style={{
            position: "relative",
            height: 40,
            paddingLeft: 16,
            paddingRight: 16,
            border: "2px solid #9ca3af",
            background: "white",
            borderRadius: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
          className="hover:bg-black hover:text-white"
        >
          <Users style={{ width: 16, height: 16 }} />
          Friends
          {totalNotifications > 0 && (
            <Badge
              style={{
                position: "absolute",
                top: -8,
                right: -8,
                height: 20,
                minWidth: 20,
                padding: 0,
                borderRadius: 9999,
                border: "2px solid #000",
                background: "#ef4444",
                color: "white",
                fontSize: 10,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {totalNotifications}
            </Badge>
          )}
        </Button>
      </DialogTrigger>

      <DialogContent
        style={{
          width: "min(680px, calc(100vw - 2rem))",
          maxHeight: "min(640px, calc(100vh - 4rem))",
          padding: 0,
          background: "white",
          border: "2px solid black",
          borderRadius: 12,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            background: "black",
            color: "white",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: "#ef4444",
              border: "2px solid black",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Users style={{ width: 22, height: 22, color: "white" }} />
          </div>
          <DialogHeader style={{ padding: 0 }}>
            <DialogTitle style={{ color: "white" }}>Friends</DialogTitle>
          </DialogHeader>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, color: "black" }}>
          {notice && (
            <div
              style={{
                border: "2px solid black",
                borderRadius: 12,
                padding: "10px 12px",
                background:
                  notice.type === "success"
                    ? "rgba(34,197,94,0.15)"
                    : notice.type === "error"
                      ? "rgba(239,68,68,0.15)"
                      : "rgba(0,0,0,0.06)",
                color: "black",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {notice.message}
            </div>
          )}

          <div
            style={{
              border: "2px solid black",
              borderRadius: 12,
              background: "white",
              padding: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <div style={{ fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: "rgba(0,0,0,0.6)" }}>
                Your Chain ID
              </div>
              <div
                style={{
                  fontFamily: "monospace",
                  fontSize: 12,
                  color: "black",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: 520,
                }}
                title={currentChainId}
              >
                {currentChainId || "—"}
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={() => currentChainId && copyToClipboard(currentChainId)}
              disabled={!currentChainId}
              style={{
                height: 36,
                width: 40,
                border: "2px solid black",
                borderRadius: 10,
                background: "white",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                flexShrink: 0,
              }}
              className="hover:bg-black hover:text-white"
            >
              <Copy style={{ width: 16, height: 16 }} />
            </Button>
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              padding: 4,
              border: "2px solid black",
              borderRadius: 10,
              background: "white",
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab("friends")}
              style={{
                flex: 1,
                height: 36,
                borderRadius: 8,
                border: "2px solid black",
                background: activeTab === "friends" ? "black" : "white",
                color: activeTab === "friends" ? "white" : "black",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              My Friends
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("requests")}
              style={{
                flex: 1,
                height: 36,
                borderRadius: 8,
                border: "2px solid black",
                background: activeTab === "requests" ? "black" : "white",
                color: activeTab === "requests" ? "white" : "black",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              Requests
              {totalNotifications > 0 && (
                <span
                  style={{
                    height: 18,
                    minWidth: 18,
                    padding: "0 6px",
                    borderRadius: 9999,
                    border: "2px solid black",
                    background: "#ef4444",
                    color: "white",
                    fontSize: 10,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {totalNotifications}
                </span>
              )}
            </button>
          </div>

          {activeTab === "friends" ? (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: 10,
                    border: "2px solid black",
                    background: "white",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    paddingLeft: 12,
                    paddingRight: 12,
                  }}
                >
                  <Search style={{ width: 16, height: 16, color: "rgba(0,0,0,0.6)" }} />
                  <input
                    value={newFriendId}
                    onChange={(e) => setNewFriendId(e.target.value)}
                    placeholder="Paste friend's Chain ID"
                    style={{
                      width: "100%",
                      height: 32,
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      fontSize: 14,
                    }}
                  />
                </div>

                <Button
                  onClick={handleAddFriend}
                  disabled={isLoading || !newFriendId.trim()}
                  style={{
                    height: 40,
                    width: 44,
                    border: "2px solid black",
                    borderRadius: 10,
                    background: "#ef4444",
                    color: "white",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                  }}
                  className="hover:bg-red-600"
                >
                  {isLoading ? (
                    <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" />
                  ) : (
                    <UserPlus style={{ width: 16, height: 16 }} />
                  )}
                </Button>
              </div>

              <div
                style={{
                  height: 320,
                  borderRadius: 12,
                  border: "2px solid black",
                  background: "white",
                  overflowY: "auto",
                }}
              >
                {friends.length === 0 ? (
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      padding: 24,
                      color: "rgba(0,0,0,0.6)",
                      textAlign: "center",
                    }}
                  >
                    <Users style={{ width: 32, height: 32, opacity: 0.4 }} />
                    <div style={{ color: "black", fontWeight: 600 }}>No friends yet</div>
                    <div style={{ fontSize: 12 }}>
                      Add friends by their Chain ID to invite them to games.
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12 }}>
                    {friends.map((friendId) => (
                      <div
                        key={friendId}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          border: "2px solid black",
                          borderRadius: 12,
                          padding: "10px 12px",
                          background: "rgba(0,0,0,0.03)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 9999,
                              border: "2px solid black",
                              background: "white",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 12,
                              fontWeight: 800,
                            }}
                          >
                            {friendId.substring(0, 2).toUpperCase()}
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 240 }}>
                              {friendId}
                            </div>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(friendId)}
                              style={{
                                border: "none",
                                background: "transparent",
                                padding: 0,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                fontSize: 12,
                                color: "rgba(0,0,0,0.65)",
                                cursor: "pointer",
                                width: "fit-content",
                              }}
                            >
                              <Copy style={{ width: 14, height: 14 }} />
                              Copy
                            </button>
                          </div>
                        </div>

                        {gameMode && onInviteToGame ? (
                          <Button
                            onClick={() => handleInviteToGame(friendId)}
                            disabled={invitingFriendId === friendId}
                            style={{
                              height: 32,
                              paddingLeft: 12,
                              paddingRight: 12,
                              border: "2px solid black",
                              borderRadius: 10,
                              background: "#ef4444",
                              color: "white",
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                            className="hover:bg-red-600"
                          >
                            {invitingFriendId === friendId ? (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />
                                Inviting...
                              </span>
                            ) : (
                              "Invite"
                            )}
                          </Button>
                        ) : (
                          <span style={{ fontSize: 12, color: "rgba(0,0,0,0.6)" }}>Friend</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div
              style={{
                height: 372,
                borderRadius: 12,
                border: "2px solid black",
                background: "white",
                overflowY: "auto",
              }}
            >
              {friendRequests.length === 0 && roomInvitations.length === 0 ? (
                <div
                  style={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: 24,
                    color: "rgba(0,0,0,0.6)",
                    textAlign: "center",
                  }}
                >
                  <Bell style={{ width: 32, height: 32, opacity: 0.4 }} />
                  <div style={{ color: "black", fontWeight: 600 }}>No pending requests</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 12 }}>
                  {friendRequests.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: "rgba(0,0,0,0.6)" }}>
                        Friend requests
                      </div>
                      {friendRequests.map((reqId) => (
                        <div
                          key={reqId}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            border: "2px solid black",
                            borderRadius: 12,
                            padding: "10px 12px",
                            background: "rgba(0,0,0,0.03)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                            <div
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 9999,
                                border: "2px solid black",
                                background: "white",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 12,
                                fontWeight: 800,
                              }}
                            >
                              ?
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 700 }}>Friend request</div>
                              <div style={{ fontSize: 12, fontFamily: "monospace", color: "rgba(0,0,0,0.6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 280 }}>
                                {reqId}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              type="button"
                              onClick={() => handleAcceptFriend(reqId)}
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: 10,
                                border: "2px solid black",
                                background: "#ef4444",
                                color: "white",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                              }}
                            >
                              <Check style={{ width: 16, height: 16 }} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeclineFriend(reqId)}
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: 10,
                                border: "2px solid black",
                                background: "white",
                                color: "black",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                              }}
                            >
                              <X style={{ width: 16, height: 16 }} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {roomInvitations.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: "rgba(0,0,0,0.6)" }}>
                        Game invites
                      </div>
                      {roomInvitations.map((invite) => (
                        <div
                          key={invite.hostChainId}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            border: "2px solid black",
                            borderRadius: 12,
                            padding: "10px 12px",
                            background: "rgba(0,0,0,0.03)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                            <div
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 9999,
                                border: "2px solid black",
                                background: "black",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              <Play style={{ width: 16, height: 16, color: "white" }} />
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 700 }}>Join game</div>
                              <div style={{ fontSize: 12, fontFamily: "monospace", color: "rgba(0,0,0,0.6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 280 }}>
                                Host: {invite.hostChainId}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              type="button"
                              onClick={() => handleAcceptInvite(invite.hostChainId)}
                              disabled={acceptingInviteHostId === invite.hostChainId}
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: 10,
                                border: "2px solid black",
                                background: "#ef4444",
                                color: "white",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                              }}
                            >
                              {acceptingInviteHostId === invite.hostChainId ? (
                                <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" />
                              ) : (
                                <Check style={{ width: 16, height: 16 }} />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeclineInvite(invite.hostChainId)}
                              disabled={acceptingInviteHostId === invite.hostChainId}
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: 10,
                                border: "2px solid black",
                                background: "white",
                                color: "black",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                              }}
                            >
                              <X style={{ width: 16, height: 16 }} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
